/**
 * The autonomous loop every collaborating agent runs (architect + implementers
 * share it; only the system prompt differs). Modeled on goal mode: auto-approve
 * + a guarded multi-iteration loop that terminates when the agent calls
 * `collab_done`. The loop plumbing (bounded retry back-off, reactive
 * compaction, stuck detection, abort handling) is the SDK's shared
 * {@link runReactLoop}; this file contributes the collaboration POLICY:
 *   - cooperative PAUSE: while the human has paused the team, the agent idles
 *     (it has already finished its current tool batch) until resumed/aborted
 *     (`onIterationStart`).
 *   - AWARENESS: new inbox messages + human directives are injected as a
 *     volatile nudge each iteration, so the agent reacts even without
 *     explicitly calling collab_inbox (`onIterationStart`).
 *   - idle stop: an agent that goes quiet without calling collab_done is
 *     retried a bounded number of rounds, then stopped (idle checkpoint).
 *   - terminal tool: `collab_done` ends the run (`onToolBatchEnd`).
 */

import {
  runReactLoop,
  type ModeContext,
  type MoxxyEvent,
  type PermissionResolver,
  type TurnCheckpoint,
} from '@moxxy/sdk';
import { getProcessHubClient, type CollabMessage } from '@moxxy/plugin-collab';
import { COLLAB_MAX_ITERATIONS_ENV, COLLAB_PLUGIN_ID } from './constants.js';

const COLLAB_DONE_TOOL = 'collab_done';
const DEFAULT_MAX_ITERATIONS = 60;

/** The per-peer iteration cap the coordinator forwarded via env (config's
 *  `peerMaxIterations`), if any and valid. */
function peerMaxIterationsFromEnv(): number | undefined {
  const raw = process.env[COLLAB_MAX_ITERATIONS_ENV];
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}
const MAX_NOOP_ITERATIONS = 3;
const PAUSE_POLL_MS = 1000;

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
  // Announce active work so the roster/UI shows 'working' (not a stale
  // 'connected') for the whole turn. Best-effort; the run proceeds regardless.
  if (hub) await hub.setStatus('working').catch(() => undefined);
  let lastInboxTs = 0;
  let wasPaused = false;

  // An agent that went quiet without calling collab_done: give it a bounded
  // number of extra rounds, then stop — the coordinator integrates whatever
  // was completed.
  const idleStop: TurnCheckpoint = {
    name: 'collab-idle',
    gateOn: 'idle',
    run: async (check) => {
      if (check.consecutiveIdle >= MAX_NOOP_ITERATIONS) {
        await agentCtx.emit({
          type: 'assistant_message',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'system',
          content:
            'Collaborative agent went idle without calling collab_done. Stopping this agent; the coordinator will integrate whatever was completed.',
          stopReason: 'end_turn',
        });
        return { action: 'stop' };
      }
      return { action: 'retry' };
    },
  };

  yield* runReactLoop(agentCtx, {
    strategyName: 'collaborative',
    defaultMaxIterations: peerMaxIterationsFromEnv() ?? DEFAULT_MAX_ITERATIONS,
    errorPrefix: 'collab agent: ',
    checkpoints: [idleStop],
    // idleStop stops itself at MAX_NOOP_ITERATIONS, before this backstop can
    // trip — it exists so a future checkpoint bug degrades loudly.
    maxInjections: MAX_NOOP_ITERATIONS,
    stuck: {
      abortedResultMessage: 'collab agent aborted (stuck pattern) before this call ran',
      nearHint: 'against the same target (only volatile args varied)',
      fatalMessage: ({ toolName, count, how }) =>
        `collab agent aborted — stuck pattern: tool "${toolName}" called ${count} times ${how}.`,
    },
    onIterationStart: async (loopCtx, iteration) => {
      if (!hub) return undefined;

      // Cooperative pause — the human stepped in. Idle until resumed/aborted.
      let control = await hub.roster().then((r) => r.control).catch(() => undefined);
      while (control?.paused && !loopCtx.signal.aborted) {
        if (!wasPaused) {
          wasPaused = true;
          await loopCtx.emit(pluginEvent(ctx, 'collab_peer_paused', { iteration }));
        }
        await sleep(PAUSE_POLL_MS, loopCtx.signal);
        control = await hub.roster().then((r) => r.control).catch(() => undefined);
      }
      if (wasPaused && !control?.paused) {
        wasPaused = false;
        await loopCtx.emit(pluginEvent(ctx, 'collab_peer_resumed', { iteration }));
      }
      // An abort during the pause poll is caught by the loop core right after
      // this hook returns — no provider call is made.
      if (loopCtx.signal.aborted) return undefined;

      // Awareness: surface new inbox messages + directives as a volatile nudge.
      const fresh = await hub.inbox(lastInboxTs).then((r) => r.messages).catch(() => []);
      if (fresh.length === 0) return undefined;
      lastInboxTs = Math.max(lastInboxTs, ...fresh.map((m) => m.ts));
      return { volatileUserText: formatInboxNudge(fresh) };
    },
    onToolBatchEnd: async (loopCtx, { toolUses }) => {
      if (!toolUses.some((t) => t.name === COLLAB_DONE_TOOL)) return undefined;
      await loopCtx.emit({
        type: 'assistant_message',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'system',
        content: '✓ Sub-task complete — reported to the team.',
        stopReason: 'end_turn',
      });
      return { action: 'stop' };
    },
    onMaxIterations: async (loopCtx, maxIterations) => {
      await loopCtx.emit({
        type: 'error',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        source: 'system',
        kind: 'fatal',
        message: `collab agent reached the iteration cap (${maxIterations}) without calling collab_done.`,
      });
    },
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
    const onAbort = (): void => {
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(() => {
      // Remove the abort listener on the normal-timeout path too; the pause
      // poll loop runs this repeatedly and the listeners would otherwise pile
      // up on the agent's long-lived signal.
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    t.unref?.();
    signal.addEventListener('abort', onAbort, { once: true });
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
