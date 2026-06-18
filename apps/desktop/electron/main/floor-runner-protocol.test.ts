import { describe, it, expect } from 'vitest';
import { RUNNER_PROTOCOL_VERSION } from '@moxxy/runner';
import { FLOOR_RUNNER_PROTOCOL } from './floor-runner-protocol';

// Lockstep guard (catches in normal CI what build-app-bundle.mjs's assertion
// otherwise only catches at release time). The desktop's baked floor protocol
// must never EXCEED the runner's current protocol — a floor above the runner
// means the desktop would reject the runner it ships with (the bug that bricked
// the v5 release when the floor was left at 4).
//
// The floor is allowed to LAG the runner only when the newer protocol is purely
// ADDITIVE and every new method is version-gated with a graceful fallback (e.g.
// v10 `session.loadHistory`: the renderer falls back to its NDJSON store against
// a <v10 runner, so the desktop must keep accepting a v9 runner — raising the
// floor to 10 would wrongly reject it and reintroduce the hot-update skew bug).
// A BREAKING protocol change must instead raise BOTH the floor and the runner's
// MIN_COMPATIBLE in the same change. This mirrors build-app-bundle.mjs's
// FLOOR <= RUNNER_PROTOCOL_VERSION guard.
describe('FLOOR_RUNNER_PROTOCOL', () => {
  it('never exceeds @moxxy/runner RUNNER_PROTOCOL_VERSION', () => {
    expect(FLOOR_RUNNER_PROTOCOL).toBeLessThanOrEqual(RUNNER_PROTOCOL_VERSION);
  });
});
