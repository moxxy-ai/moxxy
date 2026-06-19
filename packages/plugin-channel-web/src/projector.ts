import { isFileDiffDisplay, type MoxxyEvent, type ViewDoc } from '@moxxy/sdk';
import type { ServerFrame } from './protocol.js';

/**
 * Cap on in-flight present_view calls awaiting their tool_result. A normal turn
 * has at most a handful; entries only linger when a turn is aborted/errors before
 * the tool resolves (no matching tool_result ever arrives). Bound it so an
 * accumulation of aborts over a very long session can't leak unboundedly.
 */
const MAX_PENDING_CALLS = 64;

/**
 * Folds the session's event stream into {@link ServerFrame}s for the browser.
 * Stateful: it correlates a `present_view` `tool_call_requested` with its
 * `tool_result` (to read the validated AST) and tracks the last view id so each
 * new view `replaces` the prior one. One projector per channel (single-user
 * surface); it renders ANY turn on the shared log, including ones the surface
 * didn't initiate — that is what gives mirror-to-both for free.
 */
export class EventProjector {
  private readonly presentCalls = new Map<string, { fallbackText?: string }>();
  private lastViewId: string | null = null;
  private viewSeq = 0;

  project(event: MoxxyEvent): ServerFrame[] {
    switch (event.type) {
      case 'user_prompt': {
        // Hide the synthesized ui-action turns; show real user prompts.
        if (!event.text.trim() || event.text.startsWith('[ui-action]')) return [];
        return [{ kind: 'message', turnId: String(event.turnId), role: 'user', text: event.text }];
      }
      case 'tool_call_requested': {
        if (event.name === 'present_view') {
          const input = event.input as { fallbackText?: string } | undefined;
          this.presentCalls.set(String(event.callId), { fallbackText: input?.fallbackText });
          // Evict the oldest pending call(s) if a long run of aborted/errored
          // turns left their tool_result-less entries stranded.
          while (this.presentCalls.size > MAX_PENDING_CALLS) {
            const oldest = this.presentCalls.keys().next().value;
            if (oldest === undefined) break;
            this.presentCalls.delete(oldest);
          }
          return [];
        }
        return [{ kind: 'status', turnId: String(event.turnId), phase: 'tool', text: `${event.name}…` }];
      }
      case 'tool_result': {
        // Rich tool results (Write/Edit) carry a structured `display`; render
        // the diff in the chat stream, independent of present_view correlation.
        const display = (event.output as { display?: unknown } | undefined)?.display;
        if (event.ok && isFileDiffDisplay(display)) {
          return [{ kind: 'file-diff', turnId: String(event.turnId), display }];
        }
        const pending = this.presentCalls.get(String(event.callId));
        if (!pending) return [];
        this.presentCalls.delete(String(event.callId));
        if (!event.ok) {
          return [{ kind: 'status', turnId: String(event.turnId), phase: 'error', text: 'view failed to render' }];
        }
        const doc = (event.output as { ast?: ViewDoc } | undefined)?.ast;
        if (!doc) return [];
        const viewId = `v_${String(event.turnId)}_${++this.viewSeq}`;
        const replaces = this.lastViewId;
        this.lastViewId = viewId;
        const name = doc.root.kind === 'element' && typeof doc.root.props.name === 'string' ? doc.root.props.name : undefined;
        return [
          {
            kind: 'view',
            viewId,
            turnId: String(event.turnId),
            replaces,
            ...(name ? { name } : {}),
            doc,
            ...(pending.fallbackText ? { fallbackText: pending.fallbackText } : {}),
          },
        ];
      }
      case 'assistant_message': {
        const frames: ServerFrame[] = [];
        if (event.content.trim()) {
          frames.push({ kind: 'message', turnId: String(event.turnId), role: 'assistant', text: event.content });
        }
        if (event.stopReason !== 'tool_use') {
          frames.push({ kind: 'status', turnId: String(event.turnId), phase: 'done', text: '' });
        }
        return frames;
      }
      case 'error': {
        return [{ kind: 'status', turnId: String(event.turnId), phase: 'error', text: event.message }];
      }
      default:
        return [];
    }
  }
}
