import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ParsedArgv } from '../../argv.js';

// Captured spies, reset per test.
const closeSpy = vi.fn(async () => {});
let setupArgs: Record<string, unknown> | undefined;
let runScheduleImpl: () => Promise<{ ok: boolean; text?: string; inboxPath?: string; error?: string }>;
const storeGet = vi.fn(async (_id: string) => ({
  id: 's1',
  name: 'nightly',
  prompt: 'do it',
  cron: '0 9 * * *',
  enabled: true,
  source: 'manual' as const,
  createdAt: Date.now(),
}));

vi.mock('../../setup.js', () => ({
  setupSessionWithConfig: vi.fn(async (opts: Record<string, unknown>) => {
    setupArgs = opts;
    return {
      session: { close: closeSpy },
      scheduler: { store: { get: storeGet } },
    };
  }),
}));

vi.mock('@moxxy/plugin-scheduler', () => ({
  isValidCron: () => true,
  runSchedule: vi.fn(() => runScheduleImpl()),
}));

vi.mock('@moxxy/core', () => ({
  runTurn: async function* () {
    // no events
  },
}));

const { runScheduleNow } = await import('./handlers.js');

function argv(id: string): ParsedArgv {
  return { positional: ['run', id], flags: {} } as unknown as ParsedArgv;
}

describe('runScheduleNow lifecycle (u24-1)', () => {
  beforeEach(() => {
    closeSpy.mockClear();
    storeGet.mockClear();
    setupArgs = undefined;
    runScheduleImpl = async () => ({ ok: true, text: 'done', inboxPath: '/tmp/inbox' });
  });

  it('boots without init-hook daemons (skipInitHooks) so the poller cannot double-fire', async () => {
    await runScheduleNow(argv('s1'));
    expect(setupArgs?.skipInitHooks).toBe(true);
  });

  it('closes the session after a successful run', async () => {
    await runScheduleNow(argv('s1'));
    expect(closeSpy).toHaveBeenCalledTimes(1);
    // Teardown now flows through the shared `closeSession` helper, which closes
    // with a uniform 'cli-exit' reason after draining persistence.
    expect(closeSpy).toHaveBeenCalledWith('cli-exit');
  });

  it('still closes the session when runSchedule throws', async () => {
    runScheduleImpl = async () => {
      throw new Error('provider exploded');
    };
    await expect(runScheduleNow(argv('s1'))).rejects.toThrow('provider exploded');
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
