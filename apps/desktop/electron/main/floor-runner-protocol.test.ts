import { describe, it, expect } from 'vitest';
import { RUNNER_PROTOCOL_VERSION } from '@moxxy/runner';
import { FLOOR_RUNNER_PROTOCOL } from './floor-runner-protocol';

// Lockstep guard (catches in normal CI what build-app-bundle.mjs's assertion
// otherwise only catches at release time): the desktop's baked floor protocol
// MUST equal the runner's current protocol. When you bump
// RUNNER_PROTOCOL_VERSION, bump FLOOR_RUNNER_PROTOCOL in the same change — this
// test fails otherwise (as the desktop release build did when v5 shipped with
// the floor left at 4).
describe('FLOOR_RUNNER_PROTOCOL', () => {
  it('equals @moxxy/runner RUNNER_PROTOCOL_VERSION', () => {
    expect(FLOOR_RUNNER_PROTOCOL).toBe(RUNNER_PROTOCOL_VERSION);
  });
});
