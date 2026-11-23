import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { removeDir } from '@moxxy/vitest-preset/fs';
import { timeStartup } from './startup-trace.js';

afterEach(() => vi.unstubAllEnvs());

it('records timing for a failed operation without recording its private error', async () => {
  const home = await mkdtemp(join(tmpdir(), 'startup-trace-'));
  try {
    vi.stubEnv('MOXXY_HOME', home);
    vi.stubEnv('MOXXY_STARTUP_TRACE', '1');
    await expect(timeStartup('test', async () => { throw Error('private'); })).rejects.toThrow('private');
    const line = await readFile(join(home, 'desktop', 'startup-traces', process.pid + '.jsonl'), 'utf8');
    expect(JSON.parse(line)).toMatchObject({ stage: 'test', ok: false, ms: expect.any(Number), pid: process.pid });
    expect(line).not.toContain('private');
  } finally { await removeDir(home); }
});

it('records retry counts and a classified cause without including command lines', async () => {
  const { startupMark } = await import('./startup-trace.js');
  const home = await mkdtemp(join(tmpdir(), 'startup-retry-'));
  try {
    vi.stubEnv('MOXXY_HOME', home);
    vi.stubEnv('MOXXY_STARTUP_TRACE', '1');
    startupMark('runner.reconnecting', 0, false, 'session-1', { attempt: 2, cause: 'socket-timeout' });
    const line = await readFile(join(home, 'desktop', 'startup-traces', process.pid + '.jsonl'), 'utf8');
    expect(JSON.parse(line)).toMatchObject({ stage: 'runner.reconnecting', sessionId: 'session-1', attempt: 2, cause: 'socket-timeout' });
  } finally { await removeDir(home); }
});
