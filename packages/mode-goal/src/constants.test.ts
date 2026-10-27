import { describe, expect, it } from 'vitest';
import { GOAL_SYSTEM_PROMPT } from './constants.js';

/**
 * Goal mode is not offered `ask_user` (nobody is there to answer), so its
 * prompt tells the agent to settle the person's choices itself and say which.
 */
describe('GOAL_SYSTEM_PROMPT', () => {
  it('has the agent decide what it would have asked, and list those choices at the end', () => {
    expect(GOAL_SYSTEM_PROMPT).toContain('Nobody is there to answer questions');
    expect(GOAL_SYSTEM_PROMPT).toContain('list each such choice in your final summary');
  });
});
