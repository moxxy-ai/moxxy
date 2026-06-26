import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// `spawnDedicatedChannel` re-invokes the CLI via node:child_process — mock it so
// the test asserts the spawn shape without launching a real process. `vi.hoisted`
// makes the mock fn available to the hoisted `vi.mock` factory.
const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(() => ({ pid: 4321, unref: (): void => {} })),
}));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

import {
  isPidAlive,
  listLiveChannelStatuses,
  liveChannelStatus,
  spawnDedicatedChannel,
  stopDedicatedChannel,
} from './channel-control.js';
import { channelStatusPath, writeChannelStatus } from './channel-status.js';

// A pid that is essentially never alive (above the platform max) → ESRCH.
const DEAD_PID = 2_000_000_000;

let home: string;
let prevHome: string | undefined;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'moxxy-channel-control-'));
  prevHome = process.env.MOXXY_HOME;
  process.env.MOXXY_HOME = home;
  spawnMock.mockClear();
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.MOXXY_HOME;
  else process.env.MOXXY_HOME = prevHome;
  fs.rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('isPidAlive', () => {
  it('is true for the current process, false for a dead/invalid pid', () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(DEAD_PID)).toBe(false);
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(-1)).toBe(false);
  });
});

describe('liveChannelStatus', () => {
  it('returns null when no status file exists', () => {
    expect(liveChannelStatus('slack')).toBeNull();
  });

  it('returns the status when the runner pid is alive', () => {
    writeChannelStatus({
      name: 'slack',
      pid: process.pid,
      startedAt: new Date().toISOString(),
      requestUrl: 'https://example.test/slack',
    });
    const s = liveChannelStatus('slack');
    expect(s?.pid).toBe(process.pid);
    expect(s?.requestUrl).toBe('https://example.test/slack');
  });

  it('self-heals a stale file (dead pid) — returns null AND removes it', () => {
    writeChannelStatus({ name: 'ghost', pid: DEAD_PID, startedAt: new Date().toISOString() });
    expect(fs.existsSync(channelStatusPath('ghost'))).toBe(true);
    expect(liveChannelStatus('ghost')).toBeNull();
    expect(fs.existsSync(channelStatusPath('ghost'))).toBe(false);
  });
});

describe('listLiveChannelStatuses', () => {
  it('returns only live channels, drops stale files, ignores unrelated files', () => {
    writeChannelStatus({ name: 'slack', pid: process.pid, startedAt: new Date().toISOString() });
    writeChannelStatus({ name: 'telegram', pid: process.pid, startedAt: new Date().toISOString() });
    writeChannelStatus({ name: 'ghost', pid: DEAD_PID, startedAt: new Date().toISOString() });
    fs.writeFileSync(path.join(home, 'vault.json'), '{}'); // unrelated file in ~/.moxxy

    const names = listLiveChannelStatuses()
      .map((s) => s.name)
      .sort();
    expect(names).toEqual(['slack', 'telegram']);
    expect(fs.existsSync(channelStatusPath('ghost'))).toBe(false);
  });

  it('returns [] when the home dir does not exist', () => {
    process.env.MOXXY_HOME = path.join(home, 'does-not-exist');
    expect(listLiveChannelStatuses()).toEqual([]);
  });
});

describe('stopDedicatedChannel', () => {
  it('reports not-running when there is no live status', () => {
    expect(stopDedicatedChannel('slack')).toBe('not-running');
  });

  it('SIGTERMs the live runner and reports stopped', () => {
    // Intercept kill so the liveness probe (signal 0) reports alive and the
    // SIGTERM is recorded rather than actually delivered.
    const killSpy = vi
      .spyOn(process, 'kill')
      .mockImplementation(((_pid: number, _sig?: string | number) => true) as typeof process.kill);
    writeChannelStatus({ name: 'slack', pid: 999_999, startedAt: new Date().toISOString() });

    expect(stopDedicatedChannel('slack')).toBe('stopped');
    expect(killSpy).toHaveBeenCalledWith(999_999, 'SIGTERM');
  });
});

describe('spawnDedicatedChannel', () => {
  it('spawns a detached, dedicated runner with a scrubbed env', () => {
    process.env.MOXXY_RUNNER_SOCKET = '/tmp/should-be-scrubbed.sock';
    process.env.MOXXY_SESSION_ID = 'should-be-scrubbed';
    try {
      const pid = spawnDedicatedChannel('slack');
      expect(pid).toBe(4321);
      expect(spawnMock).toHaveBeenCalledTimes(1);
      const [bin, argsArg, optsArg] = spawnMock.mock.calls[0] as [
        string,
        string[],
        { detached?: boolean; stdio?: string; env?: NodeJS.ProcessEnv },
      ];
      expect(bin).toBe(process.execPath);
      expect(argsArg).toEqual([process.argv[1], 'slack']);
      expect(optsArg.detached).toBe(true);
      expect(optsArg.stdio).toBe('ignore');
      // Dedicated flag set; addressing vars scrubbed so the channel isolates.
      expect(optsArg.env?.MOXXY_DEDICATED_RUNNER).toBe('1');
      expect(optsArg.env?.MOXXY_RUNNER_SOCKET).toBeUndefined();
      expect(optsArg.env?.MOXXY_SESSION_ID).toBeUndefined();
    } finally {
      delete process.env.MOXXY_RUNNER_SOCKET;
      delete process.env.MOXXY_SESSION_ID;
    }
  });
});
