import { describe, expect, it, vi } from 'vitest';
import { asToolCallId, autoApproveSwitch, type MoxxyEvent, type ProviderDef } from '@moxxy/sdk';
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

  it('still asks the person about a call that must be answered by them, while standing rules decide first', async () => {
    const { s, prompted, ctx } = promptingSession();
    await s.setAutoApprove(true);

    expect((await s.resolver.check(call(), { ...ctx, askPerson: true })).mode).toBe('deny');
    expect(prompted).toHaveBeenCalledOnce();

    await s.permissions.addAllow({ name: 'Read' });
    expect((await s.resolver.check(call('Read'), { ...ctx, askPerson: true })).mode).toBe('allow');
    expect(prompted).toHaveBeenCalledOnce();
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

describe("an agent connection's own setting", () => {
  /** A connection whose agent, set up by the person, answers `own` for the folder. */
  function agentSession(own: (cwd: string) => Promise<boolean | undefined>) {
    const s = new Session({ cwd: '/tmp/project', silent: true });
    const asked: string[] = [];
    const def: ProviderDef = {
      name: 'claude-agent',
      models: [],
      createClient: () => ({}) as never,
      ownAutoApprove: async ({ cwd }) => {
        asked.push(cwd);
        return own(cwd);
      },
    };
    s.providers.register(def);
    s.providers.register({ name: 'anthropic', models: [], createClient: () => ({}) as never });
    return { s, asked };
  }

  it('is the conversation auto-approve from the first moment: read as the connection becomes active', async () => {
    const { s, asked } = agentSession(async () => true);

    s.providers.setActive('claude-agent');

    await vi.waitFor(() => expect(s.getInfo().autoApprove).toBe(true));
    expect(asked).toEqual(['/tmp/project']);
    const [recorded] = s.log.slice();
    expect(recorded).toMatchObject({ source: 'system', payload: { enabled: true } });
  });

  it("never overrides a switch the conversation already recorded, even one the person made while it was read", async () => {
    let answer: (own: boolean) => void = () => undefined;
    const { s } = agentSession(() => new Promise((resolve) => (answer = resolve)));
    s.providers.setActive('claude-agent');

    await s.setAutoApprove(true);
    await s.setAutoApprove(false);
    answer(true);

    await vi.waitFor(() => expect(s.log.length).toBe(2));
    await new Promise((resolve) => setImmediate(resolve));
    expect(s.getInfo().autoApprove).toBe(false);
    expect(s.log.length).toBe(2);
  });

  it('reads it again for a new conversation, and records nothing when the agent asks anyway', async () => {
    let own = false;
    const { s, asked } = agentSession(async () => own);
    s.providers.setActive('claude-agent');
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    expect(s.log.length).toBe(0);

    own = true;
    await s.reset();

    await vi.waitFor(() => expect(s.getInfo().autoApprove).toBe(true));
  });

  it('is not read for a connection without one, nor kept when the person switched connection meanwhile', async () => {
    let answer: (own: boolean) => void = () => undefined;
    const { s } = agentSession(() => new Promise((resolve) => (answer = resolve)));

    s.providers.setActive('claude-agent');
    s.providers.setActive('anthropic');
    answer(true);
    await new Promise((resolve) => setImmediate(resolve));

    expect(s.getInfo().autoApprove).toBe(false);
  });
});
