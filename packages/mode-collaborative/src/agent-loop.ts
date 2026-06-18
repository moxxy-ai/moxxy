/**
 * The autonomous loop every collaborating agent runs (architect + implementers
 * share it; only the system prompt differs). Modeled on goal mode: auto-approve
 * + a guarded multi-iteration loop that terminates when the agent calls
 * `collab_done`. On top of that it adds two collaboration behaviors when a hub
 * is present:
 *   - cooperative PAUSE: while the human has paused the team, the agent idles
 *     (it has already finished its current tool batch) until resumed/aborted.
 *   - AWARENESS: new inbox messages + human directives are injected as a
 *     volatile nudge each iteration, so the agent reacts even without explicitly
 *     calling collab_inbox.
 */

import {
  buildSystemPromptWithSkills,
  collectProviderStream,
  createStuckLoopDetector,
  emitRequestsAndDetectStuck,
  executeToolUses,
  isContextOverflowError,
  projectMessages,
  runCompactionIfNeeded,
  runElisionIfNeeded,
  usageEventFields,
  type ModeContext,
  type MoxxyEvent,
  type PermissionResolver,
} from '@moxxy/sdk';
import { getProcessHubClient, type CollabMessage } from '@moxxy/plugin-collab';
import { COLLAB_PLUGIN_ID } from './constants.js';

const COLLAB_DONE_TOOL = 'collab_done';
const DEFAULT_MAX_ITERATIONS = 60;
const MAX_NOOP_ITERATIONS = 3;
const PAUSE_POLL_MS = 1000;
const MAX_REACTIVE_COMPACTIONS = 2;

export interface CollabAgentLoopOptions {
  readonly systemPrompt: string;
}

export async function* runCollabAgentLoop(
  ctx: ModeContext,
  opts: CollabAgentLoopOptions,
): AsyncIterable<MoxxyEvent> {
  if (ctx.signal.aborted) {
    yield await ctx.emit(abort(ctx, 'aborted before collaborative agent start'));
    return;
  }

  const sessionResolver = ctx.permissions;
  const autoApprove: PermissionResolver = {
    name: 'collab-auto-approve',
    check: async (call, permCtx) => {
      const policy = (await sessionResolver.policyCheck?.(call, permCtx)) ?? null;
      if (policy) return policy;
      return { mode: 'allow', reason: 'collaborative agent runs tools unattended (auto-approve)' };
    },
  };
  const agentCtx: ModeContext = {
    ...ctx,
    systemPrompt: compose(ctx.systemPrompt, opts.systemPrompt),
    permissions: autoApprove,
  };

  const hub = await getProcessHubClient();
  const detector = createStuckLoopDetector();
  const maxIterations = ctx.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  let noop = 0;
  let reactiveCompactions = 0;
  let lastInboxTs = 0;
  let wasPaused = false;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    if (ctx.signal.aborted) {
      yield await ctx.emit(abort(ctx, 'signal aborted'));
      return;
    }

    // Cooperative pause — the human stepped in. Idle until resumed/aborted.
    if (hub) {
      let control = await hub.roster().then((r) => r.control).catch(() => undefined);
      while (control?.paused && !ctx.signal.aborted) {
        if (!wasPaused) {
          wasPaused = true;
          yield await ctx.emit(pluginEvent(ctx, 'collab_peer_paused', { iteration }));
        }
        await sleep(PAUSE_POLL_MS, ctx.signal);
        control = await hub.roster().then((r) => r.control).catch(() => undefined);
      }
      if (wasPaused && !control?.paused) {
        wasPaused = false;
        yield await ctx.emit(pluginEvent(ctx, 'collab_peer_resumed', { iteration }));
      }
      if (ctx.signal.aborted) {
        yield await ctx.emit(abort(ctx, 'signal aborted'));
        return;
      }
    }

    yield await ctx.emit({
      type: 'mode_iteration',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      strategy: 'collaborative',
      iteration,
    });

    await runCompactionIfNeeded(agentCtx);
    await runElisionIfNeeded(agentCtx);

    // Awareness: surface new inbox messages + directives as a volatile nudge.
    let nudge: string | undefined;
    if (hub) {
      const fresh = await hub.inbox(lastInboxTs).then((r) => r.messages).catch(() => []);
      if (fresh.length > 0) {
        lastInboxTs = Math.max(lastInboxTs, ...fresh.map((m) => m.ts));
        nudge = formatInboxNudge(fresh);
      }
    }

    const baseSystem = buildSystemPromptWithSkills(agentCtx.systemPrompt, agentCtx.skills.list()) ?? '';
    const { messages, stablePrefixIndex } = projectMessages(agentCtx, {
      ...(baseSystem ? { systemPrompt: baseSystem } : {}),
      ...(nudge ? { trailingUserText: nudge } : {}),
    });

    yield await ctx.emit({
      type: 'provider_request',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      provider: agentCtx.provider.name,
      model: agentCtx.model,
    });

    const { text, toolUses, stopReason, error, usage, reasoning } = await collectProviderStream(
      agentCtx,
      messages,
      { iteration, stablePrefixIndex, ...(nudge ? { volatileTailCount: 1 } : {}) },
    );

    yield await ctx.emit({
      type: 'provider_response',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      source: 'system',
      provider: agentCtx.provider.name,
      model: agentCtx.model,
      ...usageEventFields(usage),
    });

    if (error) {
      if (isContextOverflowError(error.message) && reactiveCompactions < MAX_REACTIVE_COMPACTIONS) {
        reactiveCompactions += 1;
        if (await runCompactionIfNeeded(agentCtx, { force: true })) {
          yield await ctx.emit({
            type: 'error',
            sessionId: ctx.sessionId,
            turnId: ctx.turnId,
            source: 'system',
            kind: 'retryable',
            message: 'context window exceeded — compacted older turns, retrying',
          });
          continue;
        }
      }
      yield await ctx.emit({
        type: 'error',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'system',
        kind: error.retryable ? 'retryable' : 'fatal',
        message: `collab agent: ${error.message}`,
      });
      if (!error.retryable) return;
      continue;
    }
    reactiveCompactions = 0;

    if (reasoning) {
      yield await ctx.emit({
        type: 'reasoning_message',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'model',
        content: reasoning.text,
        ...(reasoning.signature ? { signature: reasoning.signature } : {}),
        ...(reasoning.redacted ? { redacted: true } : {}),
        ...(reasoning.encrypted ? { encrypted: reasoning.encrypted } : {}),
      });
    }

    const stuck = yield* emitRequestsAndDetectStuck(ctx, toolUses, detector, {
      abortedResultMessage: 'collab agent aborted (stuck pattern) before this call ran',
      nearHint: 'against the same target (only volatile args varied)',
      fatalMessage: ({ toolName, count, how }) =>
        `collab agent aborted — stuck pattern: tool "${toolName}" called ${count} times ${how}.`,
    });
    if (stuck) return;

    if (text || stopReason === 'end_turn' || toolUses.length === 0) {
      yield await ctx.emit({
        type: 'assistant_message',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'model',
        content: text,
        stopReason,
      });
    }

    if (toolUses.length === 0) {
      noop += 1;
      if (noop >= MAX_NOOP_ITERATIONS) {
        yield await ctx.emit({
          type: 'assistant_message',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'system',
          content:
            'Collaborative agent went idle without calling collab_done. Stopping this agent; the coordinator will integrate whatever was completed.',
          stopReason: 'end_turn',
        });
        return;
      }
      continue;
    }
    noop = 0;

    const exited = yield* executeToolUses(agentCtx, toolUses, iteration);
    if (exited) return;

    if (toolUses.some((t) => t.name === COLLAB_DONE_TOOL)) {
      yield await ctx.emit({
        type: 'assistant_message',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'system',
        content: '✓ Sub-task complete — reported to the team.',
        stopReason: 'end_turn',
      });
      return;
    }
  }

  yield await ctx.emit({
    type: 'error',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'system',
    kind: 'fatal',
    message: `collab agent reached the iteration cap (${maxIterations}) without calling collab_done.`,
  });
}

function compose(user: string | undefined, layer: string): string {
  if (!user || user.trim() === '') return layer;
  return `${layer}\n\n---\n\n${user}`;
}

function formatInboxNudge(messages: ReadonlyArray<CollabMessage>): string {
  const directives = messages.filter((m) => m.from === 'human' || m.subject === 'directive');
  const rest = messages.filter((m) => !(m.from === 'human' || m.subject === 'directive'));
  const lines: string[] = [];
  if (directives.length > 0) {
    lines.push('HUMAN DIRECTIVE (authoritative — follow it, even if it changes your current plan):');
    for (const m of directives) lines.push(`- ${m.body}`);
  }
  if (rest.length > 0) {
    lines.push('New team messages:');
    for (const m of rest) lines.push(`- [${m.from} → ${m.to}] ${m.subject ? `${m.subject}: ` : ''}${m.body}`);
  }
  return lines.join('\n');
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

function abort(ctx: ModeContext, reason: string): MoxxyEvent {
  return {
    type: 'abort',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'system',
    reason,
  } as MoxxyEvent;
}

function pluginEvent(ctx: ModeContext, subtype: string, payload: unknown): MoxxyEvent {
  return {
    type: 'plugin_event',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'plugin',
    pluginId: COLLAB_PLUGIN_ID,
    subtype,
    payload,
  } as MoxxyEvent;
}
