/**
 * Regression tests for two security-boundary findings on the worker
 * isolator:
 *
 *  - u64-2: the synthetic `ctx.signal` handed to a handler used to be a
 *    fresh, never-aborted AbortController — cooperative cancel inside
 *    the worker was dead. It must now fire on timeout / host-abort.
 *
 *  - u64-1: the `createWorkerIsolator` JSDoc threat-model block used to
 *    contradict the shipped behavior (claimed `node:fs` was unblocked
 *    and only `readFile` was brokered). The documented capability
 *    surface must match the enforced one.
 */
import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BLOCKED_HANDLER_MODULES } from '@moxxy/plugin-security';
import type { IsolatedToolCall } from '@moxxy/sdk';
import { createWorkerIsolator } from './index.js';

const fixtureUrl = new URL('./__fixtures__/echo-handler.mjs', import.meta.url).href;

const call = (over: Partial<IsolatedToolCall> = {}): IsolatedToolCall => ({
  toolName: 'sig',
  input: {},
  callId: 'c1',
  sessionId: 's1',
  turnId: 't1',
  cwd: os.tmpdir(),
  moduleRef: { url: fixtureUrl, export: 'signalFlushHandler' },
  ...over,
});

describe('worker isolator: ctx.signal is wired (u64-2)', () => {
  it('fires ctx.signal on timeout so a cooperative handler can flush', async () => {
    // The handler parks on ctx.signal, then writes a sentinel via the
    // broker as its cleanup. With a permanently-inert signal the
    // handler would never wake and the sentinel would never appear.
    const sentinel = path.join(os.tmpdir(), `moxxy-sig-timeout-${Date.now()}.txt`);
    await fs.unlink(sentinel).catch(() => undefined);
    const iso = createWorkerIsolator();
    await expect(
      iso.run(
        call({ input: { sentinel } }),
        async () => 'unused',
        { timeMs: 100, fs: { write: [`${os.tmpdir()}/**`] } },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/exceeded 100ms budget/);

    // The brokered flush is serviced during the grace window. Poll
    // briefly for the sentinel (the write round-trips after the parent
    // promise has already rejected).
    let wrote = false;
    for (let i = 0; i < 30 && !wrote; i++) {
      try {
        const body = await fs.readFile(sentinel, 'utf8');
        expect(body).toBe('flushed-on-abort');
        wrote = true;
      } catch {
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    await fs.unlink(sentinel).catch(() => undefined);
    expect(wrote).toBe(true);
  });

  it('fires ctx.signal on external host-abort', async () => {
    const sentinel = path.join(os.tmpdir(), `moxxy-sig-abort-${Date.now()}.txt`);
    await fs.unlink(sentinel).catch(() => undefined);
    const iso = createWorkerIsolator();
    const ctrl = new AbortController();
    const promise = iso.run(
      call({ input: { sentinel } }),
      async () => 'unused',
      { timeMs: 10_000, fs: { write: [`${os.tmpdir()}/**`] } },
      ctrl.signal,
    );
    // Give the worker time to boot and park on the signal, then abort.
    setTimeout(() => ctrl.abort(), 200);
    await expect(promise).rejects.toThrow(/aborted/);

    let wrote = false;
    for (let i = 0; i < 30 && !wrote; i++) {
      try {
        const body = await fs.readFile(sentinel, 'utf8');
        expect(body).toBe('flushed-on-abort');
        wrote = true;
      } catch {
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    await fs.unlink(sentinel).catch(() => undefined);
    expect(wrote).toBe(true);
  });

  // Sanity: a valid (non-aborted) run still completes normally and the
  // signal is NOT spuriously aborted — the wiring must not break the
  // happy path.
  it('does not pre-abort ctx.signal on a normal completion', async () => {
    const iso = createWorkerIsolator();
    const out = await iso.run(
      call({ moduleRef: { url: fixtureUrl, export: 'echoHandler' }, input: { foo: 'bar' } }),
      async () => 'unused',
      { timeMs: 5000 },
      new AbortController().signal,
    );
    expect(out).toEqual({ input: { foo: 'bar' }, sessionId: 's1', cwd: os.tmpdir() });
  });
});

describe('worker isolator: documented capability surface matches enforced (u64-1)', () => {
  // Read the source so the assertions pin the actual JSDoc text. If the
  // doc drifts back to the old (false) claims, these fail in review.
  const indexSrc = fileURLToPath(new URL('./index.ts', import.meta.url));
  const source = readFileSync(indexSrc, 'utf8');

  it('every brokered fs op the doc lists is actually exposed on the broker', () => {
    // The shim broker surface (the enforced reality) brokers all four
    // fs ops plus fetch and exec. The doc must not claim only readFile
    // is brokered.
    for (const op of ['readFile', 'writeFile', 'readdir', 'stat']) {
      expect(source).toContain(`${op}:`);
    }
    expect(source).toContain('fetch:');
    expect(source).toContain('exec:');
    // The doc must NOT resurrect the stale "only readFile is brokered"
    // / "Phase 2.2" claim.
    expect(source).not.toMatch(/only\s+`?readFile`?\s+is brokered/i);
    expect(source).not.toMatch(/Phase 2\.2/);
  });

  it('the doc no longer claims direct node:fs imports bypass the broker', () => {
    // The loader hook DOES block direct node:fs imports now. The doc's
    // threat-model block must reflect that closure, not the old
    // "advisory broker / future loader-hook" wording.
    expect(source).not.toMatch(/broker is advisory/i);
    expect(source).not.toMatch(/A future loader-hook layer/i);
    // It should affirmatively call out the loader hook closing the gap.
    expect(source).toMatch(/loader hook/i);
  });

  it('the loader actually blocks the modules the doc says it blocks', () => {
    // Cross-check the enforced blocklist (runtime value) against the
    // module names the doc enumerates as blocked.
    expect(BLOCKED_HANDLER_MODULES).toContain('node:fs');
    expect(BLOCKED_HANDLER_MODULES).toContain('node:child_process');
    expect(BLOCKED_HANDLER_MODULES).toContain('node:net');
    expect(BLOCKED_HANDLER_MODULES).toContain('node:http');
    expect(BLOCKED_HANDLER_MODULES).toContain('node:tls');
    // Bare-specifier aliases are covered too.
    expect(BLOCKED_HANDLER_MODULES).toContain('fs');
    expect(BLOCKED_HANDLER_MODULES).toContain('child_process');

    for (const mod of ['node:fs', 'node:child_process', 'node:net', 'node:http']) {
      expect(source).toContain(mod);
    }
  });

  it('the doc still discloses the genuinely-open gaps (env / VM / reflective escapes)', () => {
    // The remaining honest gaps must stay documented.
    expect(source).toMatch(/process\.env/);
    expect(source).toMatch(/eval/);
    expect(source).toMatch(/createRequire/i);
  });
});
