/**
 * Installing and updating an agent connection's CLI from the desktop: the
 * vendor's installer or the agent's own update runs here, its lines reach the
 * window, and every runner checks again afterwards. The installers and CLIs
 * are real scripts in a temporary home; the runners are stood in for at their
 * process boundary.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeInstaller, writeFakeCli } from '@moxxy/vitest-preset/fake-cli';
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

// npm's OpenCode on Windows is a native opencode.exe behind its shim; the
// stand-in is a Node script, so it says so.
const OPENCODE: AgentCliDescriptor = {
  ...OPENCODE_CLI,
  windowsShim: { entry: 'node_modules/opencode-ai/bin/opencode.cjs', runs: 'node' },
};

/** OpenCode installed by `script`, a Node script body the installer line runs. */
const installer = (script: string): Record<string, AgentCliDescriptor> => ({
  opencode: { ...OPENCODE, install: fakeInstaller(home ?? newHome(), script) },
});

// Windows runs installers through PowerShell, which can take seconds to start on CI.
const INSTALL_TIMEOUT_MS = 30_000;

describe('installing an agent CLI from the desktop', () => {
  it('sends each line and how far it got to the window, then has every runner check again', async () => {
    const search = { home: newHome(), pathEnv: '' };
    const runners = [runner(), runner()];
    const progress: AgentCliProgress[] = [];

    const result = await runAgentCli('opencode', 'install', {
      runners: () => runners,
      emit: (p) => progress.push(p),
      agents: installer("console.log('Installing opencode'); console.log('#### 50.0%'); console.log('Installed');"),
      search,
    });

    expect(result).toEqual({ ok: true, message: 'Installed' });
    expect(progress).toEqual([
      { provider: 'opencode', action: 'install', line: 'Installing opencode' },
      { provider: 'opencode', action: 'install', line: '#### 50.0%', fraction: 0.5 },
      { provider: 'opencode', action: 'install', line: 'Installed' },
    ]);
    expect(runners.map((r) => r.checks)).toEqual([1, 1]);
   }, INSTALL_TIMEOUT_MS);

  it('says why it failed, and still has the runners look again', async () => {
    const runners = [runner()];

    const result = await runAgentCli('opencode', 'install', {
      runners: () => runners,
      emit: () => undefined,
      agents: installer("console.error('curl: (6) Could not resolve host'); process.exit(6);"),
      search: { home: newHome(), pathEnv: '' },
    });

    expect(result).toEqual({ ok: false, message: 'curl: (6) Could not resolve host' });
    expect(runners[0]?.checks).toBe(1);
   }, INSTALL_TIMEOUT_MS);

  it('runs one install of a CLI at a time', async () => {
    const deps = {
      runners: () => [],
      emit: () => undefined,
      agents: installer("setTimeout(() => console.log('done'), 1000);"),
      search: { home: newHome(), pathEnv: '' },
    };

    const first = runAgentCli('opencode', 'install', deps);
    const second = await runAgentCli('opencode', 'install', deps);

    expect(second).toEqual({ ok: false, message: 'OpenCode is already being installed or updated.' });
    expect(await first).toEqual({ ok: true, message: 'done' });
   }, INSTALL_TIMEOUT_MS);

  it('knows only the agent connections', async () => {
    expect(await runAgentCli('anthropic', 'install', { runners: () => [], emit: () => undefined })).toEqual({
      ok: false,
      message: 'anthropic has no agent CLI to install or update.',
    });
  });
});

describe('updating an agent CLI from the desktop', () => {
  /** OpenCode under the home; returns the file its `upgrade` leaves behind. */
  function installedOpenCode(): string {
    const upgraded = path.join(newHome(), 'upgraded');
    writeFakeCli(
      path.join(home ?? newHome(), '.opencode', 'bin', 'opencode'),
      `if (args[0] === 'upgrade') { console.log('Upgraded'); require('fs').writeFileSync(${JSON.stringify(upgraded)}, ''); }`,
      { windowsEntry: OPENCODE.windowsShim.entry },
    );
    return upgraded;
  }

  it("waits until no turn runs: the update replaces the CLI a turn runs on", async () => {
    const upgraded = installedOpenCode();

    const result = await runAgentCli('opencode', 'update', {
      runners: () => [runner(), runner(['turn-1'])],
      emit: () => undefined,
      agents: { opencode: OPENCODE },
      search: { home, pathEnv: '' },
    });

    expect(result).toEqual({ ok: false, message: 'Wait until the running turns end: the update replaces the OpenCode they run on.' });
    expect(existsSync(upgraded)).toBe(false);
  });

  it("updates with the agent's own command when nothing runs", async () => {
    const upgraded = installedOpenCode();

    const result = await runAgentCli('opencode', 'update', {
      runners: () => [runner()],
      emit: () => undefined,
      agents: { opencode: OPENCODE },
      search: { home, pathEnv: '' },
    });

    expect(result).toEqual({ ok: true, message: 'Upgraded' });
    expect(existsSync(upgraded)).toBe(true);
  });

  describe('when the update ends well and the version stays', () => {
    const saved = process.env.MOXXY_HOME;
    afterEach(() => {
      if (saved === undefined) delete process.env.MOXXY_HOME;
      else process.env.MOXXY_HOME = saved;
    });

    it('notes the version in the shared cache, so it is not offered again', async () => {
      process.env.MOXXY_HOME = path.join(newHome(), 'moxxy');
      const cacheFile = path.join(process.env.MOXXY_HOME, 'cache', 'agent-cli-latest.json');
      mkdirSync(path.dirname(cacheFile), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify({ [OPENCODE.npmPackage]: { version: '9.9.9', at: Date.now() } }));
      writeFakeCli(
        path.join(home!, '.opencode', 'bin', 'opencode'),
        "if (args[0] === '--version') console.log('1.20.0'); else console.log('Already up to date');",
        { windowsEntry: OPENCODE.windowsShim.entry },
      );

      await runAgentCli('opencode', 'update', {
        runners: () => [runner()],
        emit: () => undefined,
        agents: { opencode: OPENCODE },
        search: { home, pathEnv: '' },
      });

      expect(JSON.parse(readFileSync(cacheFile, 'utf8'))).toMatchObject({ [OPENCODE.npmPackage]: { notBrought: '9.9.9' } });
    });
  });

  describe("with the desktop's own Node first on its PATH", () => {
    const saved = process.env.PATH;
    afterEach(() => {
      process.env.PATH = saved;
    });

    it('updates with that Node last, so the update reaches the npm that installed the agent', async () => {
      const desktopNode = path.join(newHome(), 'desktop-node');
      mkdirSync(desktopNode, { recursive: true });
      writeFakeCli(
        path.join(home ?? newHome(), '.opencode', 'bin', 'opencode'),
        [
          "if (args[0] === 'upgrade') {",
          "  const entry = Object.entries(process.env).find(([key]) => key.toUpperCase() === 'PATH');",
          "  const dirs = (entry ? entry[1] : '').split(require('path').delimiter).filter(Boolean);",
          '  console.log(`last=${dirs[dirs.length - 1]}`);',
          '}',
        ].join('\n'),
        { windowsEntry: OPENCODE.windowsShim.entry },
      );
      process.env.PATH = [desktopNode, saved].join(path.delimiter);

      const result = await runAgentCli('opencode', 'update', {
        runners: () => [runner()],
        emit: () => undefined,
        agents: { opencode: OPENCODE },
        search: { home, pathEnv: '' },
        hostPathDirs: [desktopNode],
      });

      expect(result).toEqual({ ok: true, message: `last=${desktopNode}` });
    });
  });

  describe('when it is told nothing of where to look', () => {
    const saved = { PATH: process.env.PATH, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, NVM_DIR: process.env.NVM_DIR };
    afterEach(() => {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });

    it('updates the copy a runner finds, also one only in a folder a runner gets as a fallback', async () => {
      const upgraded = path.join(newHome(), 'upgraded');
      process.env.HOME = process.env.USERPROFILE = home;
      process.env.PATH = path.join(home!, 'empty');
      writeFakeCli(
        path.join(home!, '.nvm', 'versions', 'node', 'v24.0.0', 'bin', 'opencode'),
        `if (args[0] === 'upgrade') { console.log('Upgraded'); require('fs').writeFileSync(${JSON.stringify(upgraded)}, ''); }`,
        { windowsEntry: OPENCODE.windowsShim.entry },
      );

      const result = await runAgentCli('opencode', 'update', {
        runners: () => [runner()],
        emit: () => undefined,
        agents: { opencode: OPENCODE },
      });

      expect(result).toEqual({ ok: true, message: 'Upgraded' });
      expect(existsSync(upgraded)).toBe(true);
    });

    it("updates the copy of the node version nvm uses by default, not an older one's", async () => {
      const upgraded = path.join(newHome(), 'upgraded');
      process.env.HOME = process.env.USERPROFILE = home;
      process.env.PATH = path.join(home!, 'empty');
      delete process.env.NVM_DIR;
      const opencode = (version: string, body: string) =>
        writeFakeCli(path.join(home!, '.nvm', 'versions', 'node', version, 'bin', 'opencode'), body, {
          windowsEntry: OPENCODE.windowsShim.entry,
        });
      opencode('v20.0.0', `if (args[0] === 'upgrade') console.log('Upgraded the old one');`);
      opencode(
        'v22.0.0',
        `if (args[0] === 'upgrade') { console.log('Upgraded'); require('fs').writeFileSync(${JSON.stringify(upgraded)}, ''); }`,
      );
      mkdirSync(path.join(home!, '.nvm', 'alias'), { recursive: true });
      writeFileSync(path.join(home!, '.nvm', 'alias', 'default'), '22\n');

      const result = await runAgentCli('opencode', 'update', {
        runners: () => [runner()],
        emit: () => undefined,
        agents: { opencode: OPENCODE },
      });

      expect(result).toEqual({ ok: true, message: 'Upgraded' });
      expect(existsSync(upgraded)).toBe(true);
    });
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
