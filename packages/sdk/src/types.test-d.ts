import { describe, expectTypeOf, it } from 'vitest';
import type {
  MoxxyEvent,
  MoxxyEventOfType,
  ToolCallRequestedEvent,
  UserPromptEvent,
} from './events.js';

describe('event union narrowing', () => {
  it('MoxxyEventOfType narrows correctly', () => {
    expectTypeOf<MoxxyEventOfType<'user_prompt'>>().toEqualTypeOf<UserPromptEvent>();
    expectTypeOf<MoxxyEventOfType<'tool_call_requested'>>().toEqualTypeOf<ToolCallRequestedEvent>();
  });

  it('switch on type narrows the union', () => {
    const handle = (e: MoxxyEvent) => {
      if (e.type === 'user_prompt') {
        expectTypeOf(e).toEqualTypeOf<UserPromptEvent>();
        return e.text;
      }
      if (e.type === 'tool_call_requested') {
        expectTypeOf(e).toEqualTypeOf<ToolCallRequestedEvent>();
        return e.name;
      }
      return null;
    };
    expectTypeOf(handle).returns.toEqualTypeOf<string | null>();
  });
});
