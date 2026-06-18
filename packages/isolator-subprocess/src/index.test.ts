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

  // u62-3: the child must run with process.cwd() === call.cwd, not the
  // parent test-runner's cwd. We use a freshly-created tmp dir distinct
  // from process.cwd() so a regression (omitted spawn cwd) is detectable.
  it('honors call.cwd as the child working directory', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-cwd-'));
    // macOS tmp paths are symlinked (/var -> /private/var); process.cwd()
    // resolves to the realpath, so normalise both sides before comparing.
    const expected = await fs.realpath(dir);
    try {
      const iso = createSubprocessIsolator();
      const out = (await iso.run(
        baseCall('reportCwd', {}, {
          cwd: dir,
          moduleRef: { url: fixtureUrl, export: 'reportCwd' },
        }),
        async () => 'unused',
        {},
        new AbortController().signal,
      )) as { cwd: string };
      expect(out.cwd).toBe(expected);
      // Sanity: the child's cwd is NOT the parent runner's cwd.
      expect(out.cwd).not.toBe(process.cwd());
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  // u62-1: a handler that traps SIGTERM and busy-loops must still be
  // stopped — the isolator escalates to SIGKILL after the grace period.
  // The grace is 2s, so this test waits a few seconds past the budget.
  it('SIGKILLs a SIGTERM-ignoring runaway child after the grace period', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-kill-'));
    const pidFile = path.join(dir, 'pid');
    try {
      const iso = createSubprocessIsolator();
      const p = iso.run(
        baseCall('sigtermIgnorerSpin', { pidFile }, {
          cwd: dir,
          moduleRef: { url: fixtureUrl, export: 'sigtermIgnorerSpin' },
        }),
        async () => 'unused',
        { timeMs: 2500, fs: { write: [`${dir}/**`] } },
        new AbortController().signal,
      );
      await expect(p).rejects.toThrow(/exceeded 2500ms budget/);

      // Read the pid the child reported before it started spinning.
      let pid = 0;
      for (let i = 0; i < 50 && !pid; i++) {
        try {
          pid = Number((await fs.readFile(pidFile, 'utf8')).trim());
        } catch {
          await new Promise((r) => setTimeout(r, 50));
        }
      }
      expect(pid).toBeGreaterThan(0);

      // The process is still busy-looping right after the budget (SIGTERM
      // was trapped). It must be gone after the SIGKILL grace window.
      const alive = (target: number): boolean => {
        try {
          process.kill(target, 0);
          return true;
        } catch {
          return false;
        }
      };
      let dead = false;
      for (let i = 0; i < 60 && !dead; i++) {
        if (!alive(pid)) {
          dead = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(dead).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 15_000);

  // Counterpart to the SIGKILL test: a child that exits cleanly on
  // SIGTERM (the slowHandler simply sleeps, so its process honours the
  // cooperative kill) must NOT be needlessly escalated — and the suite
  // must not leak a pending SIGKILL timer.
  it('lets a well-behaved child exit on SIGTERM without escalation', async () => {
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

describe('subprocess loader-hook layer', () => {
  it('blocks node:fs imports inside the child', async () => {
    const iso = createSubprocessIsolator();
    await expect(
      iso.run(
        baseCall('readEtcHostsDirectly', {}, {
          moduleRef: { url: fixtureUrl, export: 'readEtcHostsDirectly' },
        }),
        async () => 'unused',
        {},
        new AbortController().signal,
      ),
    ).rejects.toThrow(/blocked import: node:fs/);
  });

  it('blocks node:child_process', async () => {
    const iso = createSubprocessIsolator();
    await expect(
      iso.run(
        baseCall('spawnDirectly', {}, {
          moduleRef: { url: fixtureUrl, export: 'spawnDirectly' },
        }),
        async () => 'unused',
        {},
        new AbortController().signal,
      ),
    ).rejects.toThrow(/blocked import: node:child_process/);
  });

  it('blocks bare specifier (fs)', async () => {
    const iso = createSubprocessIsolator();
    await expect(
      iso.run(
        baseCall('bareFsImport', {}, {
          moduleRef: { url: fixtureUrl, export: 'bareFsImport' },
        }),
        async () => 'unused',
        {},
        new AbortController().signal,
      ),
    ).rejects.toThrow(/blocked import: fs/);
  });

  it('does NOT block harmless modules (node:path)', async () => {
    const iso = createSubprocessIsolator();
    const out = await iso.run(
      baseCall('usePathModule', { input: '/tmp/x/y.txt' }, {
        moduleRef: { url: fixtureUrl, export: 'usePathModule' },
      }),
      async () => 'unused',
      {},
      new AbortController().signal,
    );
    expect(out).toBe('y.txt');
  });
});
