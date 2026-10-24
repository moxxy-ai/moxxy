/**
 * How the person's own Codex runs, read as a conversation opens so its
 * auto-approve is the truth before the first message: a short-lived
 * `codex app-server` is asked for the folder's config and closed again,
 * without starting a thread. Codex is the external boundary.
 */
import { describe, expect, it } from 'vitest';
import { FakeCodex } from './fake-codex.testkit.js';
import { codexOwnAutoApprove } from './own-settings.js';

const nothing = async () => undefined;

describe("the auto-approve of the person's own Codex", () => {
  it('is on when their config runs Codex with no approvals and full access, and leaves no Codex running', async () => {
    const codex = new FakeCodex(nothing);

    expect(await codexOwnAutoApprove('/work/app', codex.start)).toBe(true);
    expect(codex.last.cwd).toBe('/work/app');
    expect(codex.last.sent('config/read')).toEqual([{ cwd: '/work/app' }]);
    expect(codex.last.sent('thread/start')).toEqual([]);
    expect(codex.last.closed).toBe(true);
  });

  it('is off when their config asks, or keeps Codex in a sandbox', async () => {
    const asking = new FakeCodex(nothing, { approvalPolicy: 'on-request' });
    const sandboxed = new FakeCodex(nothing, { sandbox: { type: 'readOnly', networkAccess: false } });

    expect(await codexOwnAutoApprove('/work/app', asking.start)).toBe(false);
    expect(await codexOwnAutoApprove('/work/app', sandboxed.start)).toBe(false);
  });

  it('is unknown when Codex cannot be started', async () => {
    const missing = async () => Promise.reject(new Error('spawn codex ENOENT'));

    expect(await codexOwnAutoApprove('/work/app', missing)).toBeUndefined();
  });

  it('is unknown, and closes Codex, when it does not answer in time', async () => {
    const codex = new FakeCodex(nothing);
    codex.silent = true;

    expect(await codexOwnAutoApprove('/work/app', codex.start, { timeoutMs: 50 })).toBeUndefined();
    expect(codex.last.closed).toBe(true);
  });
});
