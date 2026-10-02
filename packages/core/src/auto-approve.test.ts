import { describe, expect, it, vi } from 'vitest';
import { asToolCallId, autoApproveSwitch, type MoxxyEvent } from '@moxxy/sdk';
import { withPermissionScope } from './permissions/scope.js';
import { Session } from './session.js';

const call = (name = 'Bash') => ({ callId: asToolCallId(`c-${name}`), name, input: {} });

function promptingSession() {
  const s = new Session({ cwd: '/tmp', silent: true });
  const prompted = vi.fn(async () => ({ mode: 'deny' as const, reason: 'user said no' }));
  s.setPermissionResolver({ name: 'prompt', check: prompted });
  return { s, prompted, ctx: { sessionId: String(s.id) } };
}

describe('conversation auto-approve', () => {
  it('is off until switched on, then tool calls run without asking', async () => {
    const { s, prompted, ctx } = promptingSession();
    expect(s.getInfo().autoApprove).toBe(false);

    await s.setAutoApprove(true);

    expect(s.getInfo().autoApprove).toBe(true);
    expect((await s.resolver.check(call(), ctx)).mode).toBe('allow');
    expect(prompted).not.toHaveBeenCalled();
  });

  it('records the switch in the conversation log, so every client of the conversation sees it', async () => {
    const { s } = promptingSession();
    const seen: MoxxyEvent[] = [];
    s.log.subscribe((e) => {
      seen.push(e);
    });

    await s.setAutoApprove(true);
    await s.setAutoApprove(false);

    expect(seen.map(autoApproveSwitch)).toEqual([true, false]);
  });

  it('switching it off brings the prompts back', async () => {
    const { s, prompted, ctx } = promptingSession();
    await s.setAutoApprove(true);
    await s.setAutoApprove(false);

    expect((await s.resolver.check(call(), ctx)).mode).toBe('deny');
    expect(prompted).toHaveBeenCalledOnce();
  });

  it('marks its approvals as decided now, and an allow rule from the policy as standing', async () => {
    const { s, ctx } = promptingSession();
    await s.permissions.addAllow({ name: 'computer_run' });
    await s.setAutoApprove(true);

    expect((await s.resolver.check(call('Bash'), ctx)).decidedNow).toBe(true);
    const standing = await s.resolver.check(call('computer_run'), ctx);
    expect(standing.mode).toBe('allow');
    expect(standing.decidedNow).toBeUndefined();
  });

  it('a deny rule from the permission policy still wins', async () => {
    const { s, ctx } = promptingSession();
    await s.permissions.addDeny({ name: 'Bash', reason: 'no shell' });
    await s.setAutoApprove(true);

    expect(await s.resolver.check(call('Bash'), ctx)).toEqual({ mode: 'deny', reason: 'no shell' });
  });

  it('a scoped resolver (a subagent or goal run) keeps deciding its own calls', async () => {
    const { s, ctx } = promptingSession();
    await s.setAutoApprove(true);
    const scoped = vi.fn(async () => ({ mode: 'deny' as const, reason: 'scope says no' }));

    const decision = await withPermissionScope({ name: 'scope', check: scoped }, () => s.resolver.check(call(), ctx));

    expect(decision.mode).toBe('deny');
    expect(scoped).toHaveBeenCalledOnce();
  });

  it('a new conversation starts with it off', async () => {
    const { s } = promptingSession();
    await s.setAutoApprove(true);

    await s.reset();

    expect(s.getInfo().autoApprove).toBe(false);
  });

  it('does not record a switch that changes nothing', async () => {
    const { s } = promptingSession();
    await s.setAutoApprove(false);
    expect(s.log.length).toBe(0);
  });
});
