import { describe, expect, it } from 'vitest';
import { runTask, type WorkerTask } from './worker-shim.js';

const fixtureUrl = new URL('./__fixtures__/echo-handler.mjs', import.meta.url).href;

const baseCtx = {
  sessionId: 's1',
  turnId: 't1',
  callId: 'c1',
  cwd: '/work',
};

describe('runTask', () => {
  it('imports the module + calls the named export', async () => {
    const task: WorkerTask = {
      moduleUrl: fixtureUrl,
      exportName: 'echoHandler',
      input: { foo: 'bar' },
      syntheticCtx: baseCtx,
    };
    const r = await runTask(task);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({
        input: { foo: 'bar' },
        sessionId: 's1',
        cwd: '/work',
      });
    }
  });

  it('returns an error when the export is missing', async () => {
    const r = await runTask({
      moduleUrl: fixtureUrl,
      exportName: 'noSuchExport',
      input: {},
      syntheticCtx: baseCtx,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorMessage).toMatch(/expected function/);
  });

  it('marshals handler exceptions as WorkerFail', async () => {
    const r = await runTask({
      moduleUrl: fixtureUrl,
      exportName: 'throwHandler',
      input: {},
      syntheticCtx: baseCtx,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorMessage).toBe('intentional failure');
  });

  it('returns an error when the module URL is unresolvable', async () => {
    const r = await runTask({
      moduleUrl: 'file:///definitely/not/a/real/module.mjs',
      exportName: 'x',
      input: {},
      syntheticCtx: baseCtx,
    });
    expect(r.ok).toBe(false);
  });
});
