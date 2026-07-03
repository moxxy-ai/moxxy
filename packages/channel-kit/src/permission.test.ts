import { describe, expect, it, vi } from 'vitest';
import type { PendingToolCall, PermissionContext } from '@moxxy/sdk';
import { createAuditedAllowListResolver } from './permission.js';

const ctx: PermissionContext = { sessionId: 's1' };
function call(name: string): PendingToolCall {
  return { callId: `c_${name}`, name, input: {} };
}

describe('createAuditedAllowListResolver', () => {
  it('auto-approves a listed tool and denies an unlisted one', async () => {
    const r = createAuditedAllowListResolver({
      name: 'test-allow-list',
      allowedTools: ['Read', 'Grep'],
      allToolNames: ['Read', 'Grep', 'Bash', 'Write'],
    });
    expect((await r.check(call('Read'), ctx)).mode).not.toBe('deny');
    expect((await r.check(call('Bash'), ctx)).mode).toBe('deny');
  });

  it('denies everything when the allow-list is empty (read-only)', async () => {
    const r = createAuditedAllowListResolver({
      name: 'test-allow-list',
      allowedTools: [],
      allToolNames: ['Read', 'Bash'],
    });
    expect((await r.check(call('Read'), ctx)).mode).toBe('deny');
    expect((await r.check(call('Bash'), ctx)).mode).toBe('deny');
  });

  it('expands "*" to every registered tool name', async () => {
    const r = createAuditedAllowListResolver({
      name: 'test-allow-list',
      allowedTools: ['*'],
      allToolNames: ['Read', 'Bash'],
    });
    expect((await r.check(call('Read'), ctx)).mode).not.toBe('deny');
    expect((await r.check(call('Bash'), ctx)).mode).not.toBe('deny');
    // A name not in the registry is still denied even under '*'.
    expect((await r.check(call('NotRegistered'), ctx)).mode).toBe('deny');
  });

  it('fires the audit hook for approvals only, flagging wildcard expansion', async () => {
    const onAutoApprove = vi.fn();
    const r = createAuditedAllowListResolver({
      name: 'test-allow-list',
      allowedTools: ['*'],
      allToolNames: ['Read'],
      onAutoApprove,
    });
    await r.check(call('Read'), ctx);
    expect(onAutoApprove).toHaveBeenCalledTimes(1);
    expect(onAutoApprove.mock.calls[0]?.[0]).toMatchObject({ name: 'Read' });
    expect(onAutoApprove.mock.calls[0]?.[1]).toEqual({ wildcard: true });

    onAutoApprove.mockClear();
    await r.check(call('Denied'), ctx);
    expect(onAutoApprove).not.toHaveBeenCalled();
  });

  it('carries the given resolver name', () => {
    const r = createAuditedAllowListResolver({
      name: 'my-channel-allow-list',
      allowedTools: [],
      allToolNames: [],
    });
    expect(r.name).toBe('my-channel-allow-list');
  });
});
