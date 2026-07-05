import type { ModeContext } from '../mode.js';
import type { StopReason } from '../provider-utils.js';

/**
 * Turn-end checkpoints — the extension point that lets a mode gate the moment
 * the model stops calling tools and (apparently) finishes its turn. The shared
 * ReAct loop ({@link runReactLoop}) invokes each checkpoint in declared order
 * at that instant; a checkpoint can approve the completion (`pass`), feed a
 * correction back into the conversation and keep the turn alive (`inject`),
 * re-ask the model without new input (`retry`), or end the turn on its own
 * terms (`stop`).
 *
 * A checkpoint's `run` may do anything async — run a fixed shell command via
 * `ctx.tools.execute`, or spawn and await a full child agent turn via
 * `ctx.subagents.spawn` (a lint gate, a completion reviewer). Two rules keep
 * that power safe:
 *
 *   1. Honor `check.signal` in every await. It aborts on user cancel AND on
 *      this checkpoint's `timeoutMs` — an await that ignores it outlives the
 *      turn.
 *   2. Never spawn a child running a checkpoint-bearing mode (pass
 *      `mode: 'default'`). The loop core also disarms checkpoints inside
 *      subagent sessions ({@link ModeContext.isSubagent}) as a backstop, so a
 *      mistake here degrades to an ungated child instead of unbounded
 *      recursion.
 */
export type CheckpointResult =
  | { readonly action: 'pass' }
  | {
      readonly action: 'inject';
      /**
       * Feedback fed back to the model. Persistent by default: appended to the
       * event log as a checkpoint-origin `user_prompt`, so it survives
       * resume/replay and projects into every subsequent provider call.
       * Clamped to the loop's `maxInjectBytes`.
       */
      readonly text: string;
      /**
       * When true the text is NOT logged — it rides the next provider call as
       * a volatile trailing user message (goal mode's nudge mechanism) and
       * vanishes afterwards. Use for steering ("keep going"), not for
       * substantive feedback the model must act on across several tool
       * batches. The loop forwards `volatileTailCount` to the cache strategy
       * so the rolling tail breakpoint stays ahead of it.
       */
      readonly volatile?: boolean;
    }
  /**
   * Loop again with no new input (idle-tolerant modes count idle rounds
   * before giving up). Counts against the injection budget like `inject`.
   */
  | { readonly action: 'retry' }
  /**
   * End the turn NOW, skipping any remaining checkpoints. The checkpoint is
   * expected to have already emitted its own wrap-up events via `ctx.emit`
   * (a stall notice, a completion summary) — the loop adds nothing.
   */
  | { readonly action: 'stop' };

export interface CheckpointContext {
  /** The final text the model produced for this turn-end candidate. */
  readonly candidateText: string;
  /**
   * How the provider ended the candidate call. Checkpoints that verify
   * completion claims should treat only `'end_turn'` as a claim — a
   * `'max_tokens'` candidate is a truncation, not a claim.
   */
  readonly stopReason: StopReason;
  readonly iteration: number;
  /**
   * Consecutive turn-end candidates without an intervening tool batch,
   * 1-based (this candidate included). Resets when the model does real work.
   * Idle-tolerant modes use this as their stall counter.
   */
  readonly consecutiveIdle: number;
  /** `inject`/`retry` rounds already spent this turn. */
  readonly injectionsUsed: number;
  /** The loop's `maxInjections` — lets a checkpoint soften its bar on the last round. */
  readonly injectionBudget: number;
  /**
   * Aborts on user cancel OR this checkpoint's timeout. Thread it into every
   * await (`ctx.tools.execute(..., signal)`, subagent spawns, fetches).
   */
  readonly signal: AbortSignal;
}

export interface TurnCheckpoint {
  /** Stable name — stamped on checkpoint plugin events and injected-prompt origins. */
  readonly name: string;
  /**
   * Wall-clock budget for one evaluation (default 120_000 ms, floored at
   * 1_000). On timeout the checkpoint fails OPEN: the loop logs a visible
   * warning and proceeds as if it passed — a stuck checker must never wedge
   * the turn.
   */
  readonly timeoutMs?: number;
  /**
   * Which turn-end candidates this checkpoint sees. `'end_turn'` (default)
   * gates only natural completions — truncated/errored candidates bypass it.
   * `'idle'` gates every no-tool completion regardless of stop reason
   * (goal/collab-style stall handling wants these too).
   */
  readonly gateOn?: 'end_turn' | 'idle';
  run(check: CheckpointContext, ctx: ModeContext): Promise<CheckpointResult>;
}
