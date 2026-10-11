import { describe, expect, it } from 'vitest';
import { agentModeFor } from './modes.js';

describe('the agent setting for a Moxxy mode', () => {
  it('uses the agent own plan and goal for plan and goal', () => {
    expect(agentModeFor('plan')).toBe('plan');
    expect(agentModeFor('goal')).toBe('goal');
  });

  it('runs every other mode as ordinary work: the mode itself steers above the agent', () => {
    for (const mode of ['default', 'research', 'collaborative', 'nudged']) expect(agentModeFor(mode)).toBe('default');
  });

  it('reads an old mode name as the mode it became', () => {
    expect(agentModeFor('plan-execute')).toBe('default');
  });
});
