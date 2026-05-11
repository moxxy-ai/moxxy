import type { MoxxyEvent, MoxxyEventOfType, MoxxyEventType } from './events.js';
import type { TurnId } from './ids.js';

export interface EventLogReader {
  readonly length: number;
  at(seq: number): MoxxyEvent | undefined;
  slice(from?: number, to?: number): ReadonlyArray<MoxxyEvent>;
  ofType<T extends MoxxyEventType>(type: T): ReadonlyArray<MoxxyEventOfType<T>>;
  byTurn(turnId: TurnId): ReadonlyArray<MoxxyEvent>;
  toJSON(): ReadonlyArray<MoxxyEvent>;
}
