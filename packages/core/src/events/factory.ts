import { ulid } from 'ulid';
import type {
  EventBase,
  EventId,
  EmittedEvent,
  MoxxyEvent,
  SessionId,
  TurnId,
} from '@moxxy/sdk';
import { asEventId, asSessionId, asTurnId } from '@moxxy/sdk';

export const newEventId = (): EventId => asEventId(ulid());
export const newTurnId = (): TurnId => asTurnId(ulid());
export const newSessionId = (): SessionId => asSessionId(ulid());

export function materializeEvent(
  partial: EmittedEvent,
  seq: number,
  now: () => number = Date.now,
): MoxxyEvent {
  const base: Pick<EventBase, 'id' | 'seq' | 'ts'> = {
    id: newEventId(),
    seq,
    ts: partial.ts ?? now(),
  };
  return { ...partial, ...base } as MoxxyEvent;
}
