import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyDedicatedRunnerEnv } from './start-registered-channel.js';
import type { ParsedArgv } from '../argv.js';

const argv = (flags: ParsedArgv['flags'] = {}): ParsedArgv => ({
  command: 'channel',
  positional: [],
  flags,
});

/**
 * `applyDedicatedRunnerEnv` mutates process.env, so snapshot + restore the four
 * vars it touches around every test to keep them hermetic.
 */
const KEYS = [
  'MOXXY_RUNNER_SOCKET',
  'MOXXY_SESSION_ID',
  'MOXXY_SESSION_SOURCE',
  'MOXXY_DEDICATED_RUNNER',
] as const;

describe('applyDedicatedRunnerEnv', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('honors a channel that declares dedicatedRunner + sessionSource (slack)', () => {
    applyDedicatedRunnerEnv('slack', argv(), { dedicatedRunner: true, sessionSource: 'slack' });
    expect(process.env.MOXXY_RUNNER_SOCKET).toContain('channel-slack');
    expect(process.env.MOXXY_SESSION_ID).toBe('moxxy-channel-slack');
    expect(process.env.MOXXY_SESSION_SOURCE).toBe('slack');
  });

  it('returns true and is generic over the channel name and source (telegram)', () => {
    const dedicated = applyDedicatedRunnerEnv('telegram', argv(), {
      dedicatedRunner: true,
      sessionSource: 'telegram',
    });
    expect(dedicated).toBe(true);
    expect(process.env.MOXXY_RUNNER_SOCKET).toContain('channel-telegram');
    expect(process.env.MOXXY_SESSION_ID).toBe('moxxy-channel-telegram');
    expect(process.env.MOXXY_SESSION_SOURCE).toBe('telegram');
  });

  it('returns false and does nothing for an undeclared channel with no opt-in', () => {
    const dedicated = applyDedicatedRunnerEnv('web', argv(), {});
    expect(dedicated).toBe(false);
    expect(process.env.MOXXY_RUNNER_SOCKET).toBeUndefined();
    expect(process.env.MOXXY_SESSION_ID).toBeUndefined();
    expect(process.env.MOXXY_SESSION_SOURCE).toBeUndefined();
  });

  it('opts in via the --dedicated flag even when not declared', () => {
    applyDedicatedRunnerEnv('web', argv({ dedicated: true }), {});
    expect(process.env.MOXXY_RUNNER_SOCKET).toContain('channel-web');
    expect(process.env.MOXXY_SESSION_ID).toBe('moxxy-channel-web');
    // No declared sessionSource and none provided -> left to default resolution.
    expect(process.env.MOXXY_SESSION_SOURCE).toBeUndefined();
  });

  it('opts in via MOXXY_DEDICATED_RUNNER=1', () => {
    process.env.MOXXY_DEDICATED_RUNNER = '1';
    applyDedicatedRunnerEnv('web', argv(), {});
    expect(process.env.MOXXY_SESSION_ID).toBe('moxxy-channel-web');
  });

  it('never overrides env a caller already pinned (desktop supervisor wins)', () => {
    process.env.MOXXY_RUNNER_SOCKET = '/custom.sock';
    process.env.MOXXY_SESSION_ID = 'pinned-id';
    process.env.MOXXY_SESSION_SOURCE = 'desktop';
    applyDedicatedRunnerEnv('slack', argv(), { dedicatedRunner: true, sessionSource: 'slack' });
    expect(process.env.MOXXY_RUNNER_SOCKET).toBe('/custom.sock');
    expect(process.env.MOXXY_SESSION_ID).toBe('pinned-id');
    expect(process.env.MOXXY_SESSION_SOURCE).toBe('desktop');
  });
});
