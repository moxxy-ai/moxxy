import { describe, it, expect } from 'vitest';
import { RUNNER_PROTOCOL_VERSION } from '@moxxy/runner';
import { FLOOR_RUNNER_PROTOCOL } from './floor-runner-protocol';

// Lockstep guard (catches in normal CI what build-app-bundle.mjs's assertion
// otherwise only catches at release time). The desktop's baked floor protocol
// must never EXCEED the runner's current protocol — a floor above the runner
// means the desktop would reject the runner it ships with (the bug that bricked
// the v5 release when the floor was left at 4).
//
// The floor MAY lag the runner while a new protocol method is still additive +
// version-gated with a graceful fallback (as v10 `session.loadHistory` was while
// the renderer kept an NDJSON fallback). The dual-history consolidation has now
// finished that transition — the runner is the authoritative chat-history store
// and the desktop requires v10 — so the floor is raised to 10 (== RUNNER) to drop
// <v10 runner support and let v10 JS hot-updates apply on fresh installs. The
// guard stays `<=` so a FUTURE additive+gated bump may again lag briefly; a
// BREAKING change must instead raise BOTH the floor and the runner's
// MIN_COMPATIBLE together. This mirrors build-app-bundle.mjs's
// FLOOR <= RUNNER_PROTOCOL_VERSION guard.
describe('FLOOR_RUNNER_PROTOCOL', () => {
  it('never exceeds @moxxy/runner RUNNER_PROTOCOL_VERSION', () => {
    expect(FLOOR_RUNNER_PROTOCOL).toBeLessThanOrEqual(RUNNER_PROTOCOL_VERSION);
  });
});
