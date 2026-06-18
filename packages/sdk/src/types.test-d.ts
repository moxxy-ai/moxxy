import { describe, expectTypeOf, it } from 'vitest';
import type {
  MoxxyEvent,
  MoxxyEventOfType,
  PluginRegisteredEvent,
  ToolCallRequestedEvent,
  UserPromptEvent,
} from './events.js';
import type { PluginKind } from './plugin.js';

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

describe('PluginRegisteredEvent.kind stays in sync with PluginKind', () => {
  it('the inlined kind union equals PluginKind member-for-member', () => {
    // events.ts inlines the kind union (to avoid an events↔plugin value cycle)
    // with a "keep in sync with PluginKind" note. This bidirectional equality
    // fails the build the moment PluginKind grows a member the inlined union
    // lacks (or vice versa) — exactly the drift the note was meant to prevent.
    type RegisteredKind = PluginRegisteredEvent['kind'][number];
    expectTypeOf<RegisteredKind>().toEqualTypeOf<PluginKind>();
  });
});
