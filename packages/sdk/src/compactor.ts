import type { CompactionEvent, MoxxyEvent } from './events.js';
import type { EventLogReader } from './log.js';

export interface TokenBudget {
  readonly contextWindow: number;
  readonly estimatedTokens: number;
  readonly reserveForOutput: number;
}

export interface CompactContext {
  readonly log: EventLogReader;
  readonly budget: TokenBudget;
  readonly signal: AbortSignal;
}

export interface CompactorDef {
  readonly name: string;
  shouldCompact(log: EventLogReader, budget: TokenBudget): boolean;
  compact(events: ReadonlyArray<MoxxyEvent>, ctx: CompactContext): Promise<Omit<CompactionEvent, keyof import('./events.js').EventBase> & { ts?: number }>;
}
