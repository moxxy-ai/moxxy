import { describe, expect, it } from 'vitest';
import { EXIT_AFTER_PAIR_FLAG, exitAfterPairRequested } from './channel.js';

function ctx(
  flags: Record<string, string | boolean | undefined>,
  options?: Record<string, unknown>,
): Parameters<typeof exitAfterPairRequested>[0] {
  return {
    args: { positional: [], flags },
    deps: { cwd: '/tmp', ...(options ? { options } : {}) },
  };
}

describe('exitAfterPairRequested', () => {
  it('defaults to false (standalone pair keeps the channel running)', () => {
    expect(exitAfterPairRequested(ctx({}))).toBe(false);
  });

  it('honors the flag via args.flags', () => {
    expect(exitAfterPairRequested(ctx({ [EXIT_AFTER_PAIR_FLAG]: true }))).toBe(true);
  });

  it('honors the flag via deps.options (programmatic callers)', () => {
    expect(exitAfterPairRequested(ctx({}, { [EXIT_AFTER_PAIR_FLAG]: true }))).toBe(true);
  });

  it('requires boolean true — a string "true" flag is not an opt-in', () => {
    // argv flags are string|boolean; only an explicit boolean true counts, so
    // `--exit-after-pair=weird` values can't accidentally change lifecycle.
    expect(exitAfterPairRequested(ctx({ [EXIT_AFTER_PAIR_FLAG]: 'true' }))).toBe(false);
  });
});
