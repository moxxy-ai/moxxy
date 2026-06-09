import type { CompactionEvent, MoxxyEvent } from './events.js';
import type { EventLogReader } from './log.js';
import type { LLMProvider } from './provider.js';

export interface TokenBudget {
  readonly contextWindow: number;
  readonly estimatedTokens: number;
  readonly reserveForOutput: number;
}

export interface CompactContext {
  readonly log: EventLogReader;
  readonly budget: TokenBudget;
  readonly signal: AbortSignal;
  /**
   * The session's active provider + model, when the dispatcher has them
   * (`runCompactionIfNeeded` always passes both). Lets a compactor produce a
   * REAL model-written summary instead of a lossy truncation. Optional so
   * hand-rolled callers and tests can still invoke `compact` without one —
   * compactors must degrade gracefully when absent.
   */
  readonly provider?: LLMProvider;
  readonly model?: string;
}

export interface CompactorDef {
  readonly name: string;
  shouldCompact(log: EventLogReader, budget: TokenBudget): boolean;
  compact(events: ReadonlyArray<MoxxyEvent>, ctx: CompactContext): Promise<Omit<CompactionEvent, keyof import('./events.js').EventBase> & { ts?: number }>;
}
