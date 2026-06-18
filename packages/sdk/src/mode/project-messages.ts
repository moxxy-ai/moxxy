import type { ContentBlock, ProviderMessage } from '../provider.js';
import type { ModeContext } from '../mode.js';
import type { Skill } from '../skill.js';
import type { CompactionEvent, MoxxyEvent, UserPromptEvent } from '../events.js';
import {
  computeElisionState,
  conversationalStub,
  conversationalStubbed,
  toolResultBytes,
  toolResultStub,
  toolResultStubbed,
  type ElisionState,
} from '../elision-state.js';
import { isToolDisplayResult } from '../tool-display.js';

/** Appended to the system prompt while elision is active (see projection). */
export const ELISION_SYSTEM_NOTE =
  'Context note: to stay within budget, older turns may appear as stubs like ' +
  '`[output elided — recall("id") to view]` or `[elided user turn · recall({ seq: N })]`. ' +
  'These are NOT the real content — call the `recall` tool with the given id/seq to fetch ' +
  'the full text before relying on any detail from an elided turn. Recent turns are always ' +
  'shown verbatim.';

/**
 * Compose a model-facing system prompt that includes any base prompt
 * plus a COMPACT skill index (name + description + triggers only).
 *
 * Lazy-loading design: the body is intentionally NOT inlined. The model
 * matches user intent against the description/triggers, then calls the
 * `load_skill` tool to fetch the body of the skill it picked. This keeps
 * the system prompt small even with many skills installed and avoids
 * paying for skill bodies the model never actually follows.
 */
export function buildSystemPromptWithSkills(
  baseSystemPrompt: string | undefined,
  skills: ReadonlyArray<Skill>,
): string | undefined {
  if (skills.length === 0) return baseSystemPrompt;
  const header =
    `## Available skills\n\n` +
    `Each line below is a pre-authored playbook for a specific intent. ` +
    `When the user's request matches one of these (by name, description, ` +
    `or triggers), call \`load_skill({ name: "<skill-name>" })\` FIRST to ` +
    `fetch the full instructions, then follow them verbatim. Prefer using ` +
    `a skill over re-deriving the workflow with ad-hoc tools.\n`;
  const entries = skills
    .map((s) => {
      const fm = s.frontmatter;
      const triggerHint = fm.triggers?.length
        ? ` (triggers: ${fm.triggers.map((t) => `"${t}"`).join(', ')})`
        : '';
      return `- **${fm.name}** — ${fm.description}${triggerHint}`;
    })
    .join('\n');
  const skillBlock = `${header}\n${entries}`;
  return baseSystemPrompt ? `${baseSystemPrompt}\n\n${skillBlock}` : skillBlock;
}

export interface ProjectMessagesOptions {
  /** Optional system prompt; emitted as the first message when set. */
  readonly systemPrompt?: string;
  /** Optional trailing user message — useful for plan-execute's "Focus on this step now: X". */
  readonly trailingUserText?: string;
  /**
   * Optional precomputed elision state for THIS exact log snapshot. When a
   * caller already derived it within the same loop iteration (e.g. the
   * compaction/elision gates), threading it here skips a redundant
   * `computeElisionState` fold. MUST be the state of the same log — a stale one
   * would mis-render stubs — so it is purely an opt-in fast path; omitting it
   * recomputes (memoized on the log version), byte-identically.
   */
  readonly precomputedElisionState?: ElisionState;
}

interface CompactionRange {
  readonly from: number;
  readonly to: number;
  readonly summary: string;
}

function activeCompactionRanges(events: ReadonlyArray<MoxxyEvent>): ReadonlyArray<CompactionRange> {
  return events
    .filter((event): event is CompactionEvent =>
      event.type === 'compaction' &&
      event.tokensSaved > 0 &&
      event.summary.trim().length > 0 &&
      event.replacedRange[0] <= event.replacedRange[1],
    )
    .map((event) => ({
      from: event.replacedRange[0],
      to: event.replacedRange[1],
      summary: event.summary,
    }));
}

function eventInCompactionRange(
  seq: number,
  ranges: ReadonlyArray<CompactionRange>,
): CompactionRange | null {
  for (const range of ranges) {
    if (seq >= range.from && seq <= range.to) return range;
  }
  return null;
}

/**
 * A compaction lookup that answers "which range (if any) contains `seq`" in
 * O(log ranges) instead of {@link eventInCompactionRange}'s O(ranges) linear
 * scan per event. Compaction ranges are non-overlapping ascending seq prefixes,
 * so a seq belongs to at most one range and binary search over the
 * sorted-by-`from` array returns the SAME range the linear first-match did —
 * byte-identical projection.
 *
 * Defensive fallback: if the ranges are NOT strictly non-overlapping (which the
 * compaction invariant forbids, but a hand-crafted/corrupt log could violate),
 * we keep the exact linear first-match semantics so the projection can never
 * diverge from the old code.
 */
function makeCompactionLookup(
  ranges: ReadonlyArray<CompactionRange>,
): (seq: number) => CompactionRange | null {
  if (ranges.length === 0) return () => null;
  if (ranges.length === 1) {
    const only = ranges[0]!;
    return (seq) => (seq >= only.from && seq <= only.to ? only : null);
  }
  // Sort a copy by `from` (stable enough — ranges are non-overlapping). Verify
  // the non-overlap invariant on the sorted copy; only then is binary search
  // provably equivalent to the linear first-match.
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  let nonOverlapping = true;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.from <= sorted[i - 1]!.to) {
      nonOverlapping = false;
      break;
    }
  }
  if (!nonOverlapping) return (seq) => eventInCompactionRange(seq, ranges);
  return (seq) => {
    // Largest `from <= seq`, then a single containment check.
    let lo = 0;
    let hi = sorted.length - 1;
    let cand = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid]!.from <= seq) {
        cand = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (cand < 0) return null;
    const range = sorted[cand]!;
    return seq <= range.to ? range : null;
  };
}

/**
 * Pure projection of a single `user_prompt` event to its content blocks.
 *
 * Extracted from {@link projectMessages} as an independently testable sub-step
 * (u123-5). Returns either the collapsed stub (when the event is an elided
 * conversational turn) or the full text + attachment-expanded blocks — exactly
 * what the inline switch arm produced. Caller decides how to wrap it as a
 * message / record the stable prefix.
 */
export function projectUserPrompt(event: UserPromptEvent, el: ElisionState): ContentBlock[] {
  // Elided + conversational: collapse to a stub (anchor/tiny kept full).
  if (conversationalStubbed(event, el)) {
    return [{ type: 'text', text: conversationalStub('user', event.seq) }];
  }
  const blocks: ContentBlock[] = [{ type: 'text', text: event.text }];
  if (event.attachments) {
    for (const att of event.attachments) {
      if (att.kind === 'image') {
        blocks.push({
          type: 'image',
          mediaType: att.mediaType ?? 'image/png',
          data: att.content,
        });
      } else if (att.kind === 'document') {
        blocks.push({
          type: 'document',
          mediaType: att.mediaType ?? 'application/pdf',
          data: att.content,
          ...(att.name ? { name: att.name } : {}),
        });
      } else {
        blocks.push({
          type: 'text',
          text: `[${att.kind}${att.name ? ` ${att.name}` : ''}]\n${att.content}`,
        });
      }
    }
  }
  return blocks;
}

/**
 * Precompute the set of callIds that have a matching tool_result (or
 * tool_call_denied) somewhere in the log. Used to synthesize a fallback
 * `[interrupted]` tool_result for orphan tool_use blocks when the assistant
 * message gets flushed.
 *
 * Without this fallback the provider rejects the whole conversation with
 * "assistant message with 'tool_calls' must be followed by tool messages
 * responding to each 'tool_call_id'". Orphans typically appear after a
 * cancelled turn, an aborted process, or a tool exception that bypassed the
 * loop's tool_result emit path.
 *
 * Extracted as a pure precompute (u123-5); returns a fresh mutable Set the
 * projection augments as it synthesizes orphan results (so a repeated orphan
 * across groups is only emitted once).
 */
export function resolvedCallIdSet(events: ReadonlyArray<MoxxyEvent>): Set<string> {
  const resolvedCallIds = new Set<string>();
  for (const e of events) {
    if (e.type === 'tool_result' || e.type === 'tool_call_denied') {
      resolvedCallIds.add(e.callId);
    }
  }
  return resolvedCallIds;
}

/**
 * Project the session's event log to a flat list of ProviderMessages
 * suitable for handing to `provider.stream`. Used by every loop strategy.
 *
 * Handles user_prompt, assistant_message, tool_call_requested (grouped
 * into a single assistant message of tool_use blocks), and tool_result.
 * Other event types are passed through as a no-op.
 *
 * This is THE projection every loop strategy uses; it honors compaction
 * events, turn-boundary elision, and the orphan-tool_use fallback. It lives in
 * the SDK so loop plugins stay independent of core.
 */
export interface ProjectedMessages {
  readonly messages: ProviderMessage[];
  /**
   * Index (into `messages`) of the last message belonging to the stable,
   * byte-identical prefix — i.e. produced entirely from events at or below the
   * elision high-water mark (which only advances on whole-turn boundaries, so
   * the cut never splits a message). -1 when no elision is active. The
   * `stable-prefix` cache strategy places its long-lived cross-turn breakpoint
   * here; see {@link collectProviderStream}'s `stablePrefixIndex` option.
   */
  readonly stablePrefixIndex: number;
}

export function projectMessagesFromLog(
  ctx: Pick<ModeContext, 'log'>,
  opts: ProjectMessagesOptions = {},
): ProviderMessage[] {
  return projectMessages(ctx, opts).messages;
}

/**
 * Same projection as {@link projectMessagesFromLog} but also reports the
 * stable-prefix boundary so the active cache strategy can place a cross-turn
 * breakpoint. Modes that build messages this way should thread the returned
 * `stablePrefixIndex` into {@link collectProviderStream}.
 */
export function projectMessages(
  ctx: Pick<ModeContext, 'log'>,
  opts: ProjectMessagesOptions = {},
): ProjectedMessages {
  const allEvents = ctx.log.slice();
  const compactions = activeCompactionRanges(allEvents);
  const compactionFor = makeCompactionLookup(compactions);
  const emittedCompactions = new Set<CompactionRange>();
  // Reuse a threaded state when the caller already derived it for this exact
  // snapshot; otherwise `computeElisionState` is memoized on the log version so
  // the in-iteration projection still folds only once.
  const el = opts.precomputedElisionState ?? computeElisionState(allEvents);

  const messages: ProviderMessage[] = [];
  // The stable prefix is every message produced from events at/below the
  // elision HWM. Record the latest such message index as we push.
  let stablePrefixIndex = -1;
  const recordStable = (maxSeq: number): void => {
    if (el.hwm >= 0 && maxSeq >= 0 && maxSeq <= el.hwm) {
      stablePrefixIndex = messages.length - 1;
    }
  };
  if (opts.systemPrompt) {
    // When elision is active, tell the model that older turns may be shown as
    // stubs and how to expand them — so it recalls instead of hallucinating.
    // Constant text → busts the system cache once (when elision starts), stable
    // thereafter.
    const sysText = el.hwm >= 0 ? `${opts.systemPrompt}\n\n${ELISION_SYSTEM_NOTE}` : opts.systemPrompt;
    messages.push({ role: 'system', content: [{ type: 'text', text: sysText }] });
  }
  // Pre-scan: build the set of callIds that have a matching tool_result
  // (or tool_call_denied) somewhere in the log. Used to synthesize a
  // fallback `[interrupted]` tool_result for orphan tool_use blocks
  // when the assistant message gets flushed.
  const resolvedCallIds = resolvedCallIdSet(allEvents);

  let pendingAssistant: ProviderMessage | null = null;
  let pendingAssistantMaxSeq = -1;
  // Reasoning block awaiting attachment to the current assistant turn. Only set
  // for REPLAYABLE reasoning (Anthropic signature / redacted-or-Codex encrypted
  // blob) — render-only reasoning is never sent back. Attached as content[0] of
  // the turn's assistant message (Anthropic requires the signed thinking block
  // first on an interleaved-thinking tool-use continuation; a missing/unsigned
  // one is a hard 400). Dropped at any turn/compaction boundary it doesn't reach.
  let pendingReasoning: Extract<ContentBlock, { type: 'reasoning' }> | null = null;
  let pendingReasoningSeq = -1;
  const flush = (): void => {
    if (!pendingAssistant) return;
    const flushed = pendingAssistant;
    const groupMaxSeq = pendingAssistantMaxSeq;
    pendingAssistant = null;
    pendingAssistantMaxSeq = -1;
    messages.push(flushed);
    recordStable(groupMaxSeq);
    // Synthesize fallback tool_result messages for any tool_use blocks
    // whose callId never resolved in the event log. Has to land
    // immediately after the assistant message (and before any
    // subsequent user_prompt / assistant_message) so the provider sees
    // a clean assistant→tool-result chain.
    for (const block of flushed.content) {
      if (block.type === 'tool_use' && !resolvedCallIds.has(block.id)) {
        messages.push({
          role: 'tool_result',
          content: [
            {
              type: 'tool_result',
              toolUseId: block.id,
              content: '[tool call did not return a result — possibly interrupted or cancelled]',
              isError: true,
            },
          ],
        });
        recordStable(groupMaxSeq);
        // Mark synthesized so we don't double-emit if the same orphan
        // appears in multiple groups (defensive — shouldn't normally
        // happen since each tool_call_requested has a unique callId).
        resolvedCallIds.add(block.id);
      }
    }
  };

  for (const e of allEvents) {
    const compaction = compactionFor(e.seq);
    if (compaction) {
      if (!emittedCompactions.has(compaction)) {
        emittedCompactions.add(compaction);
        flush();
        pendingReasoning = null;
        messages.push({
          role: 'user',
          content: [{ type: 'text', text: `[summary of earlier turns]\n${compaction.summary}` }],
        });
        recordStable(compaction.to);
      }
      continue;
    }

    switch (e.type) {
      case 'user_prompt': {
        flush();
        pendingReasoning = null;
        messages.push({ role: 'user', content: projectUserPrompt(e, el) });
        recordStable(e.seq);
        break;
      }
      case 'reasoning_message': {
        // Render-only reasoning (no signature/encrypted) is never replayed —
        // it exists only for the live/scrollback "Thinking" view. Replayable
        // reasoning is stashed for content[0] of this turn's assistant message.
        if (e.signature || e.encrypted) {
          pendingReasoning = {
            type: 'reasoning',
            text: e.content,
            ...(e.signature ? { signature: e.signature } : {}),
            ...(e.redacted ? { redacted: true } : {}),
            ...(e.encrypted ? { encrypted: e.encrypted } : {}),
          };
          pendingReasoningSeq = e.seq;
        }
        break;
      }
      case 'assistant_message':
        flush();
        if (conversationalStubbed(e, el)) {
          pendingReasoning = null;
          messages.push({
            role: 'assistant',
            content: [{ type: 'text', text: conversationalStub('assistant', e.seq) }],
          });
          recordStable(e.seq);
          break;
        }
        // A tool-only turn can log an assistant_message with empty content
        // (end_turn + tool calls, no prose). Projecting it as an empty text
        // block makes some providers (Anthropic) reject the NEXT request and
        // permanently wedges the session. Skip the block — the turn's
        // tool_use blocks are projected from tool_call_requested events —
        // which also un-wedges historical logs that already contain one.
        if (e.content.trim().length === 0) {
          pendingReasoning = null;
          recordStable(e.seq);
          break;
        }
        {
          const content: Array<ProviderMessage['content'][number]> = [];
          if (pendingReasoning) {
            content.push(pendingReasoning);
            pendingReasoning = null;
          }
          content.push({ type: 'text', text: e.content });
          messages.push({ role: 'assistant', content });
        }
        recordStable(e.seq);
        break;
      case 'tool_call_requested': {
        if (!pendingAssistant) {
          // Seed the assistant turn so the signed reasoning block is content[0],
          // ahead of every tool_use (Anthropic's interleaved-thinking ordering).
          pendingAssistant = { role: 'assistant', content: pendingReasoning ? [pendingReasoning] : [] };
          if (pendingReasoning) {
            pendingAssistantMaxSeq = Math.max(pendingAssistantMaxSeq, pendingReasoningSeq);
            pendingReasoning = null;
          }
        }
        pendingAssistantMaxSeq = Math.max(pendingAssistantMaxSeq, e.seq);
        (pendingAssistant.content as Array<ProviderMessage['content'][number]>).push({
          type: 'tool_use',
          id: e.callId,
          name: e.name,
          input: e.input,
        });
        break;
      }
      case 'tool_result': {
        flush();
        // Stub bulky old tool output to a recall-able marker (decision shared
        // with estimateContextTokens via toolResultStubbed).
        let text: string;
        if (toolResultStubbed(e, el)) {
          const recalled = el.recalledCallIds.has(e.callId) || el.recalledSeqs.has(e.seq);
          text = toolResultStub(e.callId, toolResultBytes(e.output), recalled);
        } else if (e.error) {
          text = `[error:${e.error.kind}] ${e.error.message}`;
        } else if (isToolDisplayResult(e.output)) {
          // Rich result (e.g. a file diff): the model only needs the short
          // `forModel` summary — the structured `display` is for channels.
          text = e.output.forModel;
        } else {
          text = typeof e.output === 'string' ? e.output : JSON.stringify(e.output ?? '');
        }
        messages.push({
          role: 'tool_result',
          content: [{ type: 'tool_result', toolUseId: e.callId, content: text, isError: !e.ok }],
        });
        recordStable(e.seq);
        break;
      }
      default:
        break;
    }
  }
  flush();

  if (opts.trailingUserText) {
    // The trailing step nudge is volatile (changes per step), never part of
    // the stable prefix — don't record it.
    messages.push({ role: 'user', content: [{ type: 'text', text: opts.trailingUserText }] });
  }
  return { messages, stablePrefixIndex };
}
