/**
 * Installing and updating an agent connection's CLI from the desktop: the
 * vendor's installer or the agent's own update runs here, its lines reach the
 * window, and every runner checks again afterwards. The installers and CLIs
 * are real scripts in a temporary home; the runners are stood in for at their
 * process boundary.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeDirSync } from '@moxxy/vitest-preset/fs';
import { OPENCODE_CLI, type AgentCliDescriptor } from '@moxxy/agent-connection-kit';
import type { AgentCliProgress } from '@moxxy/desktop-ipc-contract';
import { checkAgentClis, runAgentCli, type AgentCliRunner } from './agent-cli';

let home: string | undefined;
afterEach(() => {
  if (home) removeDirSync(home);
  home = undefined;
});

function newHome(): string {
  home = mkdtempSync(path.join(tmpdir(), 'moxxy-desktop-agent-cli-'));
  return home;
}

function runner(runningTurns: string[] = []): AgentCliRunner & { checks: number } {
  const view = {
    checks: 0,
    getInfo: () => ({ runningTurns }),
    providerAdmin: {
      checkAgents: async () => {
        view.checks += 1;
      },
    },
  };
  return view;
}

const installer = (script: string): Record<string, AgentCliDescriptor> => ({
  opencode: { ...OPENCODE_CLI, install: { posix: script, windows: script } },
});

describe('installing an agent CLI from the desktop', () => {
  it('sends each line and how far it got to the window, then has every runner check again', async () => {
    const search = { home: newHome(), pathEnv: '' };
    const runners = [runner(), runner()];
    const progress: AgentCliProgress[] = [];

    const result = await runAgentCli('opencode', 'install', {
      runners: () => runners,
      emit: (p) => progress.push(p),
      agents: installer("echo 'Installing opencode'; printf '#### 50.0%%\\n'; echo 'Installed'"),
      search,
    });

    expect(result).toEqual({ ok: true, message: 'Installed' });
    expect(progress).toEqual([
      { provider: 'opencode', action: 'install', line: 'Installing opencode' },
      { provider: 'opencode', action: 'install', line: '#### 50.0%', fraction: 0.5 },
      { provider: 'opencode', action: 'install', line: 'Installed' },
    ]);
    expect(runners.map((r) => r.checks)).toEqual([1, 1]);
  });

  it('says why it failed, and still has the runners look again', async () => {
    const runners = [runner()];

    const result = await runAgentCli('opencode', 'install', {
      runners: () => runners,
      emit: () => undefined,
      agents: installer("echo 'curl: (6) Could not resolve host' >&2; exit 6"),
      search: { home: newHome(), pathEnv: '' },
    });

    expect(result).toEqual({ ok: false, message: 'curl: (6) Could not resolve host' });
    expect(runners[0]?.checks).toBe(1);
  });

  it('runs one install of a CLI at a time', async () => {
    const deps = {
      runners: () => [],
      emit: () => undefined,
      agents: installer('sleep 1; echo done'),
      search: { home: newHome(), pathEnv: '' },
    };

    const first = runAgentCli('opencode', 'install', deps);
    const second = await runAgentCli('opencode', 'install', deps);

    expect(second).toEqual({ ok: false, message: 'OpenCode is already being installed or updated.' });
    expect(await first).toEqual({ ok: true, message: 'done' });
  });

  it('knows only the agent connections', async () => {
    expect(await runAgentCli('anthropic', 'install', { runners: () => [], emit: () => undefined })).toEqual({
      ok: false,
      message: 'anthropic has no agent CLI to install or update.',
    });
  });
});

describe('updating an agent CLI from the desktop', () => {
  function installedOpenCode(): string {
    const file = path.join(newHome(), '.opencode/bin/opencode');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '#!/bin/sh\nif [ "$1" = "upgrade" ]; then echo "Upgraded"; touch "$0.upgraded"; fi\n');
    chmodSync(file, 0o755);
    return file;
  }

  it("waits until no turn runs: the update replaces the CLI a turn runs on", async () => {
    const file = installedOpenCode();

    const result = await runAgentCli('opencode', 'update', {
      runners: () => [runner(), runner(['turn-1'])],
      emit: () => undefined,
      search: { home, pathEnv: '' },
    });

    expect(result).toEqual({ ok: false, message: 'Wait until the running turns end: the update replaces the OpenCode they run on.' });
    expect(existsSync(`${file}.upgraded`)).toBe(false);
  });

  it("updates with the agent's own command when nothing runs", async () => {
    const file = installedOpenCode();

    const result = await runAgentCli('opencode', 'update', {
      runners: () => [runner()],
      emit: () => undefined,
      search: { home, pathEnv: '' },
    });

    expect(result).toEqual({ ok: true, message: 'Upgraded' });
    expect(existsSync(`${file}.upgraded`)).toBe(true);
  });
});

describe('checking every agent CLI', () => {
  it('asks every runner, and one that cannot answer does not stop the others', async () => {
    const ok = runner();
    const broken: AgentCliRunner = {
      getInfo: () => ({}),
      providerAdmin: {
        checkAgents: async () => {
          throw new Error('runner too old');
        },
      },
    };

    await checkAgentClis([broken, ok]);

    expect(ok.checks).toBe(1);
  });
});
