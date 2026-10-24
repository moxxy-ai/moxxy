import { asPluginId } from '../ids.js';
import type { MoxxyEvent } from '../events.js';
import type { ModeContext } from '../mode.js';
import type { StopReason } from '../provider-utils.js';
import type { CheckpointResult, TurnCheckpoint } from './checkpoint.js';

/**
 * The turn-end checkpoint gate and the loop's own lifecycle events, shared by
 * the ReAct loop and the agent-connection loop.
 */

const DEFAULT_CHECKPOINT_TIMEOUT_MS = 120_000;
const CHECKPOINT_EVENT_PLUGIN_ID = asPluginId('react-loop');

/** Gate outcome: end the turn, or loop again (optionally with a volatile nudge). */
export type GateVerdict = { readonly kind: 'end' } | { readonly kind: 'loop'; readonly volatileText?: string };

export interface GateRound {
  readonly candidateText: string;
  readonly stopReason: StopReason;
  readonly iteration: number;
  readonly consecutiveIdle: number;
  readonly injectionsUsed: number;
  readonly injectionBudget: number;
  readonly maxInjectChars: number;
}

export async function* runCheckpointGate(
  ctx: ModeContext,
  checkpoints: ReadonlyArray<TurnCheckpoint>,
  round: GateRound,
): AsyncGenerator<MoxxyEvent, GateVerdict> {
  // Natural completions face every checkpoint; truncated/errored candidates
  // only face the idle-tolerant ones — reviewing a half-sentence as if it
  // were a completion claim wastes a checker run and confuses the model.
  const eligible = checkpoints.filter(
    (cp) =>
      (round.stopReason === 'end_turn' || (cp.gateOn ?? 'end_turn') === 'idle') && (cp.applies?.(ctx) ?? true),
  );
  if (eligible.length === 0) return { kind: 'end' };

  // Budget exhausted → the answer ships as-is, but LOUDLY: silent
  // degradation would let the user believe a gated answer passed its gates.
  if (round.injectionsUsed >= round.injectionBudget) {
    yield await emitError(
      ctx,
      'retryable',
      `checkpoint budget exhausted (${round.injectionBudget} rounds) — ` +
        `ending the turn with unresolved checkpoint feedback; verify the result manually.`,
    );
    return { kind: 'end' };
  }

  for (const cp of eligible) {
    // User cancelled mid-gate: end the turn WITHOUT retracting the
    // already-logged answer — an abort must never un-say what was said.
    if (ctx.signal.aborted) return { kind: 'end' };

    yield await emitCheckpointEvent(ctx, 'checkpoint_started', {
      name: cp.name,
      iteration: round.iteration,
    });

    const timeoutMs = Math.max(1_000, cp.timeoutMs ?? DEFAULT_CHECKPOINT_TIMEOUT_MS);
    const timeoutCtl = new AbortController();
    const timer = setTimeout(() => timeoutCtl.abort(), timeoutMs);
    timer.unref?.();
    let result: CheckpointResult;
    try {
      result = await cp.run(
        {
          candidateText: round.candidateText,
          stopReason: round.stopReason,
          iteration: round.iteration,
          consecutiveIdle: round.consecutiveIdle,
          injectionsUsed: round.injectionsUsed,
          injectionBudget: round.injectionBudget,
          signal: AbortSignal.any([ctx.signal, timeoutCtl.signal]),
        },
        ctx,
      );
    } catch (err) {
      if (ctx.signal.aborted) return { kind: 'end' };
      // Fail OPEN, visibly. A crashed or timed-out checker downgrades the
      // gate to a warning — it must never wedge the turn (fail-closed is a
      // turn that can never end) and never crash it (the answer is already
      // logged).
      const why = timeoutCtl.signal.aborted
        ? `timed out after ${timeoutMs}ms`
        : `failed: ${err instanceof Error ? err.message : String(err)}`;
      yield await emitError(ctx, 'retryable', `checkpoint "${cp.name}" ${why} — proceeding unchecked`);
      continue;
    } finally {
      clearTimeout(timer);
    }

    switch (result.action) {
      case 'pass': {
        yield await emitCheckpointEvent(ctx, 'checkpoint_passed', { name: cp.name });
        continue;
      }
      case 'stop': {
        // The checkpoint already emitted its own wrap-up events.
        yield await emitCheckpointEvent(ctx, 'checkpoint_stopped', { name: cp.name });
        return { kind: 'end' };
      }
      case 'retry': {
        yield await emitCheckpointEvent(ctx, 'checkpoint_retry', { name: cp.name });
        return { kind: 'loop' };
      }
      case 'inject': {
        // Guard the guard: an inject with blank text would loop the turn
        // with no new signal for the model — a checker bug; fail open.
        const feedback = result.text?.trim();
        if (!feedback) {
          yield await emitError(
            ctx,
            'retryable',
            `checkpoint "${cp.name}" injected empty feedback — ignored`,
          );
          continue;
        }
        const clamped = clampChars(feedback, round.maxInjectChars);
        if (result.volatile) {
          yield await emitCheckpointEvent(ctx, 'checkpoint_injected', {
            name: cp.name,
            volatile: true,
          });
          return { kind: 'loop', volatileText: clamped };
        }
        // Persistent: a checkpoint-origin user prompt. Projected as a
        // user-role message by the existing projection case, marked via the
        // same `origin` machinery trigger prompts use, cache-safe because it
        // is an ordinary append at the log tail.
        yield await ctx.emit({
          type: 'user_prompt',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          source: 'system',
          text: clamped,
          origin: { kind: 'checkpoint', name: cp.name },
        });
        yield await emitCheckpointEvent(ctx, 'checkpoint_injected', {
          name: cp.name,
          volatile: false,
        });
        return { kind: 'loop' };
      }
    }
  }
  return { kind: 'end' };
}

function clampChars(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[checkpoint feedback truncated: ${text.length - max} chars dropped]`;
}

export async function emitAbort(ctx: ModeContext, reason: string): Promise<MoxxyEvent> {
  return ctx.emit({
    type: 'abort',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'system',
    reason,
  });
}

export async function emitError(
  ctx: ModeContext,
  kind: 'retryable' | 'fatal',
  message: string,
): Promise<MoxxyEvent> {
  return ctx.emit({
    type: 'error',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'system',
    kind,
    message,
  });
}

export async function emitCheckpointEvent(
  ctx: ModeContext,
  subtype: string,
  payload: unknown,
): Promise<MoxxyEvent> {
  return ctx.emit({
    type: 'plugin_event',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    source: 'system',
    pluginId: CHECKPOINT_EVENT_PLUGIN_ID,
    subtype,
    payload,
  });
}
