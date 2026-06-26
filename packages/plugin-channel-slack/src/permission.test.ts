import { describe, expect, it, vi } from 'vitest';
import type { PendingToolCall, PermissionContext } from '@moxxy/sdk';
import { buildSlackPermissionResolver } from './permission.js';

const ctx: PermissionContext = { sessionId: 's1' };
function call(name: string): PendingToolCall {
  return { callId: `c_${name}`, name, input: {} };
}

describe('buildSlackPermissionResolver', () => {
  it('auto-approves a listed tool', async () => {
    const r = buildSlackPermissionResolver({
      allowedTools: ['Read', 'Grep'],
      allToolNames: ['Read', 'Grep', 'Bash', 'Write'],
    });
    const d = await r.check(call('Read'), ctx);
    expect(d.mode).not.toBe('deny');
  });

  it('denies an unlisted tool', async () => {
    const r = buildSlackPermissionResolver({
      allowedTools: ['Read'],
      allToolNames: ['Read', 'Bash'],
    });
    const d = await r.check(call('Bash'), ctx);
    expect(d.mode).toBe('deny');
  });

  it('denies everything when the allow-list is empty (read-only)', async () => {
    const r = buildSlackPermissionResolver({
      allowedTools: [],
      allToolNames: ['Read', 'Bash'],
    });
    expect((await r.check(call('Read'), ctx)).mode).toBe('deny');
    expect((await r.check(call('Bash'), ctx)).mode).toBe('deny');
  });

  it('expands "*" to every registered tool name', async () => {
    const r = buildSlackPermissionResolver({
      allowedTools: ['*'],
      allToolNames: ['Read', 'Bash', 'Write'],
    });
    expect((await r.check(call('Read'), ctx)).mode).not.toBe('deny');
    expect((await r.check(call('Bash'), ctx)).mode).not.toBe('deny');
    expect((await r.check(call('Write'), ctx)).mode).not.toBe('deny');
    // A name not in the registry is still denied even under '*'.
    expect((await r.check(call('NotRegistered'), ctx)).mode).toBe('deny');
  });

  it('logs each auto-approved call', async () => {
    const info = vi.fn();
    const r = buildSlackPermissionResolver({
      allowedTools: ['Read'],
      allToolNames: ['Read'],
      logger: { info },
    });
    await r.check(call('Read'), ctx);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]?.[0]).toMatch(/auto-approved/);
    // A denial is NOT logged as an approval.
    info.mockClear();
    await r.check(call('Bash'), ctx);
    expect(info).not.toHaveBeenCalled();
  });
});
