import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentCliReport, ProviderDef } from '@moxxy/sdk';
import { AgentCliWatch } from './agent-cli-watch.js';
import { silentLogger } from './logger.js';
import { Session } from './session.js';

/**
 * Where each agent connection's CLI stands is one state the session keeps:
 * checked when the host starts and every hour after, read by every surface
 * through the session's info.
 */

const report = (state: AgentCliReport['state'], installed: string | null, checkedAt = 1): AgentCliReport => ({
  state,
  command: 'codex',
  installed,
  latest: '0.162.1',
  minimum: '0.155.1',
  checkedAt,
});

function agent(name: string, check: () => Promise<AgentCliReport>): ProviderDef {
  return { name, models: [], createClient: () => ({}) as never, agentCli: { check } };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('AgentCliWatch', () => {
  it('keeps the last report of every connection that has a CLI', async () => {
    const plain: ProviderDef = { name: 'anthropic', models: [], createClient: () => ({}) as never };
    const watch = new AgentCliWatch(() => [agent('codex-agent', async () => report('update-available', '0.155.1')), plain], silentLogger);

    await watch.check();

    expect(watch.report('codex-agent')).toMatchObject({ state: 'update-available', installed: '0.155.1' });
    expect(watch.report('anthropic')).toBeUndefined();
  });

  it('says when a CLI changed, not when it was merely checked again', async () => {
    let next = report('update-available', '0.155.1', 1);
    const watch = new AgentCliWatch(() => [agent('codex-agent', async () => next)], silentLogger);
    const changes = vi.fn();
    watch.onChange(changes);

    await watch.check();
    next = report('update-available', '0.155.1', 2);
    await watch.check();
    expect(changes).toHaveBeenCalledTimes(1);
    next = report('current', '0.162.1', 3);
    await watch.check();
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it('says when the agent was signed in or out', async () => {
    let next: AgentCliReport = { ...report('current', '0.162.1'), signedIn: false, account: null };
    const watch = new AgentCliWatch(() => [agent('codex-agent', async () => next)], silentLogger);
    const changes = vi.fn();
    watch.onChange(changes);

    await watch.check();
    next = { ...next, signedIn: true, account: 'ChatGPT' };
    await watch.check();

    expect(changes).toHaveBeenCalledTimes(2);
  });

  it('keeps checking the others when one check fails', async () => {
    const watch = new AgentCliWatch(
      () => [
        agent('claude-code', async () => {
          throw new Error('spawn failed');
        }),
        agent('opencode', async () => report('current', '1.19.0')),
      ],
      silentLogger,
    );

    await watch.check();

    expect(watch.report('claude-code')).toBeUndefined();
    expect(watch.report('opencode')).toMatchObject({ state: 'current' });
  });

  it('asks the registry again only when told to', async () => {
    const seen: Array<boolean | undefined> = [];
    const watch = new AgentCliWatch(
      () => [
        agent('codex-agent', async () => report('current', '0.162.1')),
        {
          ...agent('opencode', async () => report('current', '1.19.0')),
          agentCli: {
            check: async (opts) => {
              seen.push(opts?.refresh);
              return report('current', '1.19.0');
            },
          },
        },
      ],
      silentLogger,
    );

    await watch.check();
    await watch.check({ refresh: true });

    expect(seen).toEqual([false, true]);
  });

  it('checks when started and every hour after, until stopped', async () => {
    vi.useFakeTimers();
    const check = vi.fn(async () => report('current', '0.162.1'));
    const watch = new AgentCliWatch(() => [agent('codex-agent', check)], silentLogger);

    watch.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(check).toHaveBeenCalledTimes(2);
    watch.stop();
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
    expect(check).toHaveBeenCalledTimes(2);
  });
});

describe("the session's info", () => {
  it("carries each connection's CLI report", async () => {
    const session = new Session({ cwd: '/tmp', silent: true });
    session.providers.register(agent('codex-agent', async () => report('update-required', '0.150.0')));

    await session.agentClis.check();

    expect(session.getInfo().providers.find((p) => p.name === 'codex-agent')?.agentCli).toMatchObject({
      state: 'update-required',
      installed: '0.150.0',
    });
    await session.close();
  });

  it('tells its listeners when a CLI changed, with the new info', async () => {
    const session = new Session({ cwd: '/tmp', silent: true });
    let next = report('update-available', '0.155.1');
    session.providers.register(agent('codex-agent', async () => next));
    const seen: Array<string | undefined> = [];
    const off = session.onInfoChanged((info) => seen.push(info.providers.find((p) => p.name === 'codex-agent')?.agentCli?.state));

    await session.agentClis.check();
    off();
    next = report('current', '0.162.1');
    await session.agentClis.check({ refresh: true });

    expect(seen).toEqual(['update-available']);
    await session.close();
  });
});
