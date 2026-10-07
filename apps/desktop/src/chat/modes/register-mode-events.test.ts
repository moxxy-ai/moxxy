import { describe, expect, it } from 'vitest';
import { isRenderedEvent } from '@moxxy/client-core';
import type { MoxxyEvent } from '@moxxy/sdk';
import { registerModeEvents } from './register-mode-events';

/**
 * The chat store keeps only the events a surface asks for. The plan, goal and
 * research modes report through plugin events, so the desktop has to ask for
 * theirs, or the conversation never hears what they said.
 */

function plugin(pluginId: string, subtype: string): MoxxyEvent {
  return { type: 'plugin_event', id: 'e1', seq: 1, ts: 1, sessionId: 's', turnId: 't', pluginId, subtype, payload: {}, source: 'plugin' } as unknown as MoxxyEvent;
}

describe('registerModeEvents', () => {
  it('asks the chat store for what the three modes report', () => {
    registerModeEvents();
    expect(isRenderedEvent(plugin('@moxxy/mode-plan', 'plan_completed'))).toBe(true);
    expect(isRenderedEvent(plugin('@moxxy/mode-goal', 'goal_completed'))).toBe(true);
    expect(isRenderedEvent(plugin('@moxxy/mode-deep-research', 'deep_research_fanout_started'))).toBe(true);
  });

  it('asks for nothing else', () => {
    registerModeEvents();
    expect(isRenderedEvent(plugin('@moxxy/usage-stats', 'usage'))).toBe(false);
  });
});
