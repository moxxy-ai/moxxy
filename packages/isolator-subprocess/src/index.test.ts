/**
 * Subprocess isolator tests. These actually spawn a Node child process
 * per test (slower than worker tests), so the suite is intentionally
 * focused: prove round-trip + cap denial + boundary + abort + timeout.
 * Extended op coverage lives in plugin-security's broker.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IsolatedToolCall } from '@moxxy/sdk';
import { createSubprocessIsolator } from './index.js';

const fixtureUrl = new URL('./__fixtures__/broker-handler.mjs', import.meta.url).href;

const baseCall = (
  exportName: string,
  input: unknown,
  over: Partial<IsolatedToolCall> = {},
): IsolatedToolCall => ({
  toolName: exportName,
  input,
  callId: 'c1',
  sessionId: 's1',
  turnId: 't1',
  cwd: os.tmpdir(),
  moduleRef: { url: fixtureUrl, export: exportName },
  ...over,
});

describe('subprocessIsolator', () => {
  it('round-trips a handler invocation', async () => {
    const iso = createSubprocessIsolator();
    const out = await iso.run(
      baseCall('inspectCtx', {}),
      async () => 'unused',
      {},
      new AbortController().signal,
    );
    expect(out).toMatchObject({
      hasFs: true,
      hasWriteFile: true,
      hasReaddir: true,
      hasStat: true,
      hasFetch: true,
      hasExec: true,
      sessionId: 's1',
    });
  });

  it('denies when moduleRef is missing', async () => {
    const iso = createSubprocessIsolator();
    await expect(
      iso.run(
        baseCall('inspectCtx', {}, { moduleRef: undefined }),
        async () => 'unused',
        {},
        new AbortController().signal,
      ),
    ).rejects.toThrow(/no handlerModule declared/);
  });

  it('mediates fs.readFile through the broker', async () => {
    const tmp = path.join(os.tmpdir(), `moxxy-sub-${Date.now()}.txt`);
    await fs.writeFile(tmp, 'subprocess broker');
    try {
      const iso = createSubprocessIsolator();
      const out = await iso.run(
        baseCall('readViaBroker', { where: tmp }),
        async () => 'unused',
        { fs: { read: [`${os.tmpdir()}/**`] } },
        new AbortController().signal,
      );
      expect(out).toBe('subprocess broker');
    } finally {
      await fs.unlink(tmp);
    }
  });

  it('denies a brokered read for an out-of-cap path', async () => {
    const iso = createSubprocessIsolator();
    await expect(
      iso.run(
        baseCall('readViaBroker', { where: '/etc/passwd' }),
        async () => 'unused',
        { fs: { read: [`${os.tmpdir()}/**`] } },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/fs\.read capability/);
  });

  it('terminates the child on timeMs overrun', async () => {
    const iso = createSubprocessIsolator();
    await expect(
      iso.run(
        baseCall('slowHandler', { ms: 5000 }, {
          moduleRef: { url: fixtureUrl, export: 'slowHandler' },
        }),
        async () => 'unused',
        { timeMs: 200 },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/exceeded 200ms budget/);
  });

  it('honors an external abort', async () => {
    const iso = createSubprocessIsolator();
    const ctrl = new AbortController();
    const p = iso.run(
      baseCall('slowHandler', { ms: 5000 }, {
        moduleRef: { url: fixtureUrl, export: 'slowHandler' },
      }),
      async () => 'unused',
      { timeMs: 10_000 },
      ctrl.signal,
    );
    setTimeout(() => ctrl.abort(), 100);
    await expect(p).rejects.toThrow(/aborted/);
  });

  // Boundary test — proves OS-level process isolation. We set a global
  // in the parent; the child can't see it because they have separate
  // processes, separate heaps, separate V8 isolates.
  it('does NOT leak parent-process globals into the child', async () => {
    (globalThis as Record<string, unknown>)['__MOXXY_PARENT_FLAG__'] = 'parent-only';
    const iso = createSubprocessIsolator();
    const out = await iso.run(
      baseCall('readParentGlobal', {}, {
        moduleRef: { url: fixtureUrl, export: 'readParentGlobal' },
      }),
      async () => 'unused',
      {},
      new AbortController().signal,
    );
    expect(out).toEqual({ seen: null });
    delete (globalThis as Record<string, unknown>)['__MOXXY_PARENT_FLAG__'];
  });

  it('runs exec through the broker', async () => {
    const iso = createSubprocessIsolator();
    const out = (await iso.run(
      baseCall('execViaBroker', { cmd: '/bin/echo', args: ['subproc-exec'] }),
      async () => 'unused',
      { subprocess: true },
      new AbortController().signal,
    )) as { stdout: string };
    expect(out.stdout).toContain('subproc-exec');
  });
});
