import { describe, it, expect } from 'vitest';
import { RUNNER_PROTOCOL_VERSION } from '@moxxy/runner';
import { FLOOR_RUNNER_PROTOCOL } from './floor-runner-protocol';

// The floor is the protocol of the CLI this installer ships, and the ceiling
// the update gate accepts. A floor left behind the runner makes a fresh install
// refuse the next JS update stamped with its own runner's protocol, so every
// update after it needs the full installer. build-app-bundle.mjs asserts the
// same at release time.
describe('FLOOR_RUNNER_PROTOCOL', () => {
  it('equals @moxxy/runner RUNNER_PROTOCOL_VERSION', () => {
    expect(FLOOR_RUNNER_PROTOCOL).toBe(RUNNER_PROTOCOL_VERSION);
  });
});
