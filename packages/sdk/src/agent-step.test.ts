import { describe, expect, it } from 'vitest';
import type { MoxxyEvent } from './events.js';
import { isGoalMetEvent } from './agent-step.js';

const plugin = (pluginId: string, subtype: string): MoxxyEvent => ({ type: 'plugin_event', pluginId, subtype, payload: {} }) as unknown as MoxxyEvent;

describe('isGoalMetEvent', () => {
  it('is goal mode saying the goal is met, and nothing else', () => {
    expect(isGoalMetEvent(plugin('@moxxy/mode-goal', 'goal_completed'))).toBe(true);
    expect(isGoalMetEvent(plugin('@moxxy/mode-goal', 'goal_abandoned'))).toBe(false);
    expect(isGoalMetEvent(plugin('@moxxy/mode-goal', 'goal_stalled'))).toBe(false);
    expect(isGoalMetEvent(plugin('@moxxy/agent-connection', 'goal_status'))).toBe(false);
  });
});
