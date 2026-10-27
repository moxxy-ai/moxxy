import type { ModeContext } from '../mode.js';
import type { AgentGoalStatus, TokenUsage } from '../provider.js';
import type { StopReason } from '../provider-utils.js';
import type { StuckLoopReport, StuckTripInfo } from '../tool-dispatch.js';
import type { TurnCheckpoint } from './checkpoint.js';
import type { CollectedToolUse } from './collect-stream.js';

/** What a clean provider call produced — input to {@link ReactLoopOptions.onProviderSuccess}. */
export interface ProviderSuccessInfo {
  readonly text: string;
  readonly stopReason: StopReason;
  readonly toolUses: ReadonlyArray<CollectedToolUse>;
  readonly usage?: TokenUsage;
  readonly iteration: number;
}

/** A completed tool batch — input to {@link ReactLoopOptions.onToolBatchEnd}. */
export interface ToolBatchInfo {
  readonly toolUses: ReadonlyArray<CollectedToolUse>;
  readonly iteration: number;
}

/** Hooks return this to end the turn; the hook emits its own wrap-up events first. */
export interface StopDirective {
  readonly action: 'stop';
}

export interface ReactLoopOptions {
  /** Name stamped on `mode_iteration` events (e.g. `'default'`, `'goal'`). */
  readonly strategyName: string;
  /**
   * Iteration cap when the context doesn't supply one. Default 500. May be
   * `Number.POSITIVE_INFINITY` for an uncapped loop (goal mode): the run then
   * ends only via a terminal signal (checkpoint/hook stop, abort, fatal
   * error) — an explicit `ctx.maxIterations` still takes precedence.
   */
  readonly defaultMaxIterations?: number;
  /** Prefix for provider-error messages (goal mode uses `'goal: '`). */
  readonly errorPrefix?: string;
  /**
   * When set, an already-aborted signal is reported (with this reason) BEFORE
   * the first iteration — goal/collab preflight. When omitted the first
   * iteration's own abort check covers it with the generic reason.
   */
  readonly preflightAbortReason?: string;
  /** Turn-end gates, run in declared order. Omit/empty → plain ReAct loop. */
  readonly checkpoints?: ReadonlyArray<TurnCheckpoint>;
  /**
   * Hard cap on checkpoint `inject`/`retry` rounds per idle EPISODE — i.e.
   * consecutive gate rounds with no tool work between them; the count resets
   * whenever a tool batch executes (default 3). When exhausted the turn ends
   * with the model's answer as-is plus a visible warning — a
   * permanently-failing gate degrades loudly instead of looping forever.
   */
  readonly maxInjections?: number;
  /** Clamp on injected feedback length in characters (default 16_384). */
  readonly maxInjectChars?: number;
  /**
   * Stuck-loop policy + wording overrides; sensible defaults from
   * `strategyName`. `action` picks what a detector trip does:
   *
   *   - `'abort'` (default): fail the batch and end the turn with a fatal
   *     error — the historical behavior, right for attended modes where the
   *     user is present to redirect.
   *   - `'nudge'`: never stop. The batch still executes (repeated calls are
   *     usually legitimate work — re-running a failing build between edits),
   *     a visible warning + `extraOnStuck` events are emitted, the detector
   *     resets, and `nudgeText` (or a default) rides the next provider call
   *     as a volatile steer. For unattended modes (goal) where a heuristic
   *     must never kill the run.
   */
  readonly stuck?: Partial<StuckLoopReport> & {
    readonly action?: 'abort' | 'nudge';
    /** Volatile steer for `'nudge'` trips; default wording when omitted. */
    readonly nudgeText?: (info: StuckTripInfo) => string;
  };
  /**
   * Runs after compaction/elision, before the provider call. May return a
   * volatile user message to ride ONLY the next call (collab's inbox/pause
   * awareness) — never appended to the log; the cache strategy is told via
   * `volatileTailCount` so its tail breakpoint stays ahead of it.
   */
  readonly onIterationStart?: (
    ctx: ModeContext,
    iteration: number,
  ) => Promise<{ readonly volatileUserText?: string } | undefined>;
  /**
   * Runs after every clean provider call (reasoning already logged, tools not
   * yet executed). Return `{action: 'stop'}` to end the turn — the hook emits
   * its own wrap-up events first (goal mode's token-budget backstop).
   */
  readonly onProviderSuccess?: (
    ctx: ModeContext,
    info: ProviderSuccessInfo,
  ) => Promise<StopDirective | undefined>;
  /**
   * Runs after a tool batch executes cleanly. Return `{action: 'stop'}` to
   * end the turn (goal/collab terminal-tool detection: `goal_complete`,
   * `collab_done`); the hook emits its own completion events first.
   */
  readonly onToolBatchEnd?: (
    ctx: ModeContext,
    info: ToolBatchInfo,
  ) => Promise<StopDirective | undefined>;
  /**
   * Runs after an agent connection's turn that reported the state of the
   * agent's own goal. Return `{action: 'stop'}` to end the turn (goal mode
   * wraps up a met goal); the hook emits its own completion events first.
   */
  readonly onAgentGoal?: (ctx: ModeContext, status: AgentGoalStatus) => Promise<StopDirective | undefined>;
  /**
   * Agent connections only: the agent finished its own plan (Markdown). Plan
   * mode shows it as its plan card and ends the turn; without this hook the
   * plan is shown as the agent's message.
   */
  readonly onAgentPlan?: (ctx: ModeContext, plan: string) => Promise<StopDirective | undefined>;
  /**
   * Replaces the default "exceeded maxIterations" fatal error — the hook
   * emits its own cap-reached events (goal mode adds a plugin event and its
   * own wording). The loop returns right after.
   */
  readonly onMaxIterations?: (ctx: ModeContext, maxIterations: number) => Promise<void>;
}

