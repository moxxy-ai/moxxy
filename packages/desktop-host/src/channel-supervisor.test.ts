import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

// Drive `startChannel` against a fake CLI: `resolveMoxxyCli` returns a stub and
// `spawnCli` is a spy whose env we assert. `event-bus` is stubbed so broadcasts
// are no-ops. (The module is Electron-free by construction — see its header.)
const spawnCliMock = vi.fn();
vi.mock('./cli-resolver', () => ({
  augmentedPaths: () => [],
  resolveMoxxyCli: () => ({ kind: 'direct', bin: '/fake/moxxy' }),
  spawnCli: (...args: unknown[]) => spawnCliMock(...args),
}));
vi.mock('./event-bus', () => ({ broadcastHostEvent: vi.fn() }));

import { startChannel } from './channel-supervisor';

/** Minimal ChildProcess stand-in: enough surface for the supervisor's wiring. */
function fakeChild(): ChildProcess {
  const ee = new EventEmitter() as unknown as ChildProcess;
  Object.assign(ee, { pid: 4242, stderr: new EventEmitter(), kill: vi.fn() });
  return ee;
}

const originalEnv = { ...process.env };

beforeEach(() => {
  // Isolate ~/.moxxy so finalize's clearChannelStatus can't touch the real home.
  process.env.MOXXY_HOME = mkdtempSync(path.join(os.tmpdir(), 'chan-sup-'));
  spawnCliMock.mockReturnValue(fakeChild());
});

afterEach(() => {
  // Drive `exit` so the supervisor finalizes the entry (drops it from its
  // singleton map + stops the URL poll), leaving no state for the next test.
  const child = spawnCliMock.mock.results[0]?.value as ChildProcess | undefined;
  child?.emit('exit', 0, null);
  process.env = { ...originalEnv };
  vi.clearAllMocks();
});

describe('channel-supervisor startChannel', () => {
  it('opts the dedicated channel runner out of the co-attached web surface', () => {
    startChannel('telegram');

    expect(spawnCliMock).toHaveBeenCalledTimes(1);
    const [, args, opts] = spawnCliMock.mock.calls[0] as [
      unknown,
      string[],
      { env: Record<string, string> },
    ];
    expect(args).toEqual(['telegram']);
    // The runner must opt out of the web surface (else a remote channel opens a
    // proxy tunnel before writing its status file → the connect step hangs) and
    // out of Tier-2 core updates, mirroring `moxxy serve`.
    expect(opts.env).toMatchObject({
      MOXXY_DEDICATED_RUNNER: '1',
      MOXXY_NO_WEB_SURFACE: '1',
      MOXXY_NO_CORE_UPDATE: '1',
    });
  });
});
