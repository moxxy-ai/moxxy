import { expect } from 'vitest';
import type { EventLogReader, MoxxyEventType, MoxxyEventOfType } from '@moxxy/sdk';

interface CustomMatchers<R = unknown> {
  toContainEventOfType(type: MoxxyEventType): R;
  toContainToolCall(name: string): R;
  toMatchEventSequence(sequence: ReadonlyArray<MoxxyEventType>): R;
}

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-explicit-any
  interface Assertion<T = any> extends CustomMatchers<T> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends CustomMatchers {}
}

expect.extend({
  toContainEventOfType(received: EventLogReader, type: MoxxyEventType) {
    const events = received.ofType(type as 'user_prompt');
    return {
      pass: events.length > 0,
      message: () => `Expected event log to contain at least one event of type "${type}"`,
      actual: events.length,
      expected: '>=1',
    };
  },

  toContainToolCall(received: EventLogReader, name: string) {
    const calls = received
      .ofType('tool_call_requested')
      .filter((e) => (e as MoxxyEventOfType<'tool_call_requested'>).name === name);
    return {
      pass: calls.length > 0,
      message: () => `Expected event log to contain a tool_call_requested for "${name}"`,
      actual: calls.length,
      expected: '>=1',
    };
  },

  toMatchEventSequence(received: EventLogReader, sequence: ReadonlyArray<MoxxyEventType>) {
    let cursor = 0;
    for (const event of received.slice()) {
      if (cursor >= sequence.length) break;
      if (event.type === sequence[cursor]) cursor++;
    }
    const pass = cursor === sequence.length;
    return {
      pass,
      message: () =>
        pass
          ? `Expected sequence ${JSON.stringify(sequence)} NOT to match`
          : `Expected sequence ${JSON.stringify(sequence)} (matched ${cursor}/${sequence.length})`,
    };
  },
});

export type { CustomMatchers };
