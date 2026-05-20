/**
 * End-to-end broker tests: spawn a real worker_threads Worker via
 * createWorkerIsolator, run a handler that uses `ctx.fs.readFile` /
 * `ctx.fetch`, and assert the broker mediates each call on the parent
 * side. Proves the RPC round-trips and cap denial works at the actual
 * boundary.
 *
 * Input keys are deliberately `target` (not path / URL shaped) so the
 * pre-flight input cap-check passes — that way the broker is the
 * sole enforcer in these tests and we observe its specific behavior
 * rather than the upstream pre-flight catching everything.
 */
import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IsolatedToolCall } from '@moxxy/sdk';
import { createWorkerIsolator } from './index.js';

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
  cwd: '/work',
  moduleRef: { url: fixtureUrl, export: exportName },
  ...over,
});

describe('worker broker: ctx is injected', () => {
  it('handler sees the full broker surface on the synthetic ctx', async () => {
    const iso = createWorkerIsolator();
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
});

describe('worker broker: extended fs ops', () => {
  it('writeFile mediates through the broker', async () => {
    const tmp = path.join(os.tmpdir(), `moxxy-write-${Date.now()}.txt`);
    try {
      const iso = createWorkerIsolator();
      await iso.run(
        baseCall('writeViaBroker', { where: tmp, data: 'broker-wrote-this' }),
        async () => 'unused',
        { fs: { write: [`${os.tmpdir()}/**`] } },
        new AbortController().signal,
      );
      expect(await fs.readFile(tmp, 'utf8')).toBe('broker-wrote-this');
    } finally {
      await fs.unlink(tmp).catch(() => undefined);
    }
  });

  it('writeFile denied when out of cap', async () => {
    const iso = createWorkerIsolator();
    await expect(
      iso.run(
        baseCall('writeViaBroker', { where: '/etc/passwd', data: 'nope' }),
        async () => 'unused',
        { fs: { write: ['$cwd/**'] } },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/fs\.write capability/);
  });

  it('stat mediates through the broker', async () => {
    const tmp = path.join(os.tmpdir(), `moxxy-stat-${Date.now()}.txt`);
    await fs.writeFile(tmp, 'xyz');
    try {
      const iso = createWorkerIsolator();
      const out = (await iso.run(
        baseCall('statViaBroker', { where: tmp }),
        async () => 'unused',
        { fs: { read: [`${os.tmpdir()}/**`] } },
        new AbortController().signal,
      )) as { isFile: boolean; size: number };
      expect(out.isFile).toBe(true);
      expect(out.size).toBe(3);
    } finally {
      await fs.unlink(tmp);
    }
  });
});

describe('worker broker: exec', () => {
  it('runs allowed commands via the broker', async () => {
    const iso = createWorkerIsolator();
    const out = (await iso.run(
      // Use a real cwd that exists on the test host. The broker spawns
      // from the parent, which inherits the parent's CWD only if we
      // pass one; our `call.cwd = '/work'` doesn't exist in CI.
      { ...baseCall('execViaBroker', { cmd: '/bin/echo', args: ['from-worker'] }), cwd: os.tmpdir() },
      async () => 'unused',
      { subprocess: true },
      new AbortController().signal,
    )) as { stdout: string; exitCode: number | null };
    expect(out.stdout).toContain('from-worker');
    expect(out.exitCode).toBe(0);
  });

  it('denies exec when subprocess is not granted', async () => {
    const iso = createWorkerIsolator();
    await expect(
      iso.run(
        { ...baseCall('execViaBroker', { cmd: '/bin/echo', args: ['x'] }), cwd: os.tmpdir() },
        async () => 'unused',
        {}, // no subprocess cap
        new AbortController().signal,
      ),
    ).rejects.toThrow(/subprocess: true/);
  });
});

describe('worker broker: ctx.fs.readFile mediation', () => {
  it('round-trips a real file read via the broker', async () => {
    const tmp = path.join(os.tmpdir(), `moxxy-broker-e2e-${Date.now()}.txt`);
    await fs.writeFile(tmp, 'hello from broker');
    try {
      const iso = createWorkerIsolator();
      const out = await iso.run(
        baseCall('readViaBroker', { where: tmp }),
        async () => 'unused',
        { fs: { read: [`${os.tmpdir()}/**`] } },
        new AbortController().signal,
      );
      expect(out).toBe('hello from broker');
    } finally {
      await fs.unlink(tmp);
    }
  });

  it('denies a brokered read for an out-of-cap path', async () => {
    const iso = createWorkerIsolator();
    await expect(
      iso.run(
        baseCall('readViaBroker', { where: '/etc/passwd' }),
        async () => 'unused',
        { fs: { read: [`${os.tmpdir()}/**`] } }, // cap covers tmp, not /etc
        new AbortController().signal,
      ),
    ).rejects.toThrow(/outside the tool's declared fs\.read capability/);
  });

  it('denies when no fs cap is declared at all', async () => {
    const iso = createWorkerIsolator();
    await expect(
      iso.run(
        baseCall('readViaBroker', { where: '/tmp/anything' }),
        async () => 'unused',
        {}, // empty caps
        new AbortController().signal,
      ),
    ).rejects.toThrow(/outside the tool's declared fs\.read capability/);
  });
});

describe('worker broker: ctx.fetch mediation', () => {
  it('denies an out-of-allowlist host before the socket opens', async () => {
    const iso = createWorkerIsolator();
    await expect(
      iso.run(
        baseCall('fetchViaBroker', { where: 'https://evil.com/x' }),
        async () => 'unused',
        { net: { mode: 'allowlist', hosts: ['api.example.com'] } },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/outside the tool's declared net capability/);
  });

  it('denies when net cap is "none"', async () => {
    const iso = createWorkerIsolator();
    await expect(
      iso.run(
        baseCall('fetchViaBroker', { where: 'https://example.com/' }),
        async () => 'unused',
        { net: { mode: 'none' } },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/outside the tool's declared net capability/);
  });
});

describe('worker broker: advisory limit (documented)', () => {
  // The broker only mediates calls that go through ctx.fs / ctx.fetch.
  // Handlers that import `node:fs` directly bypass it. We lock this in
  // as a regression test: if a future loader-hook layer makes this
  // start failing, the test goes red on purpose and the doc updates.
  it('lets handlers bypass the broker via node:fs directly', async () => {
    const iso = createWorkerIsolator();
    // Cap says read /tmp/** only. The handler reads /etc/hosts via
    // node:fs directly — outside the cap, but not mediated.
    const out = await iso.run(
      baseCall('readEtcHostsDirectly', {}),
      async () => 'unused',
      { fs: { read: ['/tmp/**'] } },
      new AbortController().signal,
    );
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });
});
