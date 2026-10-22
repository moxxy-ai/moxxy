/**
 * The agent CLIs Moxxy connects to: where each one lives, whether it is new
 * enough, and installing or updating it with the vendor's own commands. The
 * CLIs here are real executables in a temporary home; only the npm registry
 * is stood in for.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeInstaller, writeFakeCli } from '@moxxy/vitest-preset/fake-cli';
import { removeDirSync } from '@moxxy/vitest-preset/fs';
import {
  AGENT_CLIS,
  CLAUDE_CLI,
  CODEX_CLI,
  OPENCODE_CLI,
  agentCliOrigin,
  agentCliTargetAt,
  checkAgentCli,
  findAgentCli,
  installInvocation,
  latestAgentVersion,
  runAgentCliAction,
  type AgentCliDescriptor,
} from './agent-cli.js';

let home: string | undefined;
afterEach(() => {
  if (home) removeDirSync(home);
  home = undefined;
});

function newHome(): string {
  home = mkdtempSync(path.join(tmpdir(), 'moxxy-agent-cli-'));
  return home;
}

/**
 * `desc`'s CLI at `relative` under the home: it prints `version` for
 * `--version` and runs `script` (Node, `args` in scope) otherwise. On Windows
 * it is an npm install's `.cmd` shim with the script where `desc` says it is.
 */
function cli(desc: AgentCliDescriptor, relative: string, version: string, script = ''): string {
  const file = path.join(home ?? newHome(), ...relative.split('/'));
  return writeFakeCli(file, `if (args[0] === '--version') { console.log(${JSON.stringify(version)}); process.exit(0); }\n${script}`, {
    windowsEntry: desc.windowsShim.entry,
  });
}

const noRegistry = async (): Promise<string | null> => null;

describe('the agent CLIs Moxxy knows', () => {
  it('names each by its connection, with the oldest version Moxxy was checked against', () => {
    expect(AGENT_CLIS['claude-code']).toBe(CLAUDE_CLI);
    expect(AGENT_CLIS['codex-agent']).toBe(CODEX_CLI);
    expect(AGENT_CLIS.opencode).toBe(OPENCODE_CLI);
    expect([CLAUDE_CLI, CODEX_CLI, OPENCODE_CLI].map((d) => [d.command, d.npmPackage, d.minimumVersion, d.executableEnv])).toEqual([
      ['claude', '@anthropic-ai/claude-code', '2.1.296', 'CLAUDE_CODE_EXECUTABLE'],
      ['codex', '@openai/codex', '0.155.1', 'CODEX_EXECUTABLE'],
      ['opencode', 'opencode-ai', '1.19.0', 'OPENCODE_EXECUTABLE'],
    ]);
  });

  it("updates each with the agent's own command, which knows how it was installed", () => {
    expect(CLAUDE_CLI.updateArgs).toEqual(['update']);
    expect(CODEX_CLI.updateArgs).toEqual(['update']);
    expect(OPENCODE_CLI.updateArgs).toEqual(['upgrade']);
  });

  it("installs each with the vendor's installer, on Windows through PowerShell", () => {
    expect(installInvocation(CLAUDE_CLI, 'darwin')).toEqual({
      command: '/bin/sh',
      args: ['-c', 'curl -fsSL https://claude.ai/install.sh | bash'],
    });
    expect(installInvocation(CODEX_CLI, 'linux').args[1]).toBe('curl -fsSL https://chatgpt.com/codex/install.sh | sh');
    expect(installInvocation(OPENCODE_CLI, 'linux').args[1]).toBe('curl -fsSL https://opencode.ai/install | bash');
    expect(installInvocation(CODEX_CLI, 'win32')).toEqual({
      command: expect.stringMatching(/\\WindowsPowerShell\\v1\.0\\powershell\.exe$/),
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://chatgpt.com/codex/install.ps1 | iex'],
    });
    expect(installInvocation(OPENCODE_CLI, 'win32').args.at(-1)).toBe('npm install -g opencode-ai');
  });
});

describe('finding a CLI', () => {
  it('finds one the installer put outside the PATH a desktop app starts with', () => {
    const file = cli(OPENCODE_CLI, '.opencode/bin/opencode', '1.19.0');

    expect(findAgentCli(OPENCODE_CLI, { home, pathEnv: '' })).toBe(file);
  });

  it('prefers the one on PATH, as a terminal would', () => {
    cli(CODEX_CLI, '.local/bin/codex', 'codex-cli 0.150.0');
    const onPath = cli(CODEX_CLI, 'tools/codex', 'codex-cli 0.162.1');

    expect(findAgentCli(CODEX_CLI, { home, pathEnv: path.dirname(onPath) })).toBe(onPath);
  });

  describe('when the person points at another file', () => {
    const saved = process.env.CODEX_EXECUTABLE;
    afterEach(() => {
      if (saved === undefined) delete process.env.CODEX_EXECUTABLE;
      else process.env.CODEX_EXECUTABLE = saved;
    });

    it("takes the agent's own variable, so a check, a conversation and an update use that file", async () => {
      const updated = path.join(newHome(), 'updated');
      cli(CODEX_CLI, '.local/bin/codex', 'codex-cli 0.163.0');
      const chosen = cli(CODEX_CLI, 'elsewhere/codex', 'codex-cli 0.150.0', `if (args[0] === 'update') { console.log('Updated'); require('fs').writeFileSync(${JSON.stringify(updated)}, ''); }`);
      process.env.CODEX_EXECUTABLE = chosen;

      expect(findAgentCli(CODEX_CLI, { home, pathEnv: '' })).toBe(chosen);
      expect(await runAgentCliAction(CODEX_CLI, 'update', { home, pathEnv: '' })).toEqual({ ok: true, message: 'Updated' });
      expect(existsSync(updated)).toBe(true);
    });
  });

  it('finds nothing when there is nothing', () => {
    expect(findAgentCli(CLAUDE_CLI, { home: newHome(), pathEnv: '' })).toBeNull();
  });

  describe('when the desktop could not read the terminal’s PATH', () => {
    it("prefers the vendor installer's copy to an old one in a folder added only as a fallback", () => {
      const current = cli(CLAUDE_CLI, '.local/bin/claude', '2.1.307 (Claude Code)');
      const old = cli(CLAUDE_CLI, 'homebrew/bin/claude', '2.1.63 (Claude Code)');
      const fallback = path.dirname(old);

      expect(findAgentCli(CLAUDE_CLI, { home, pathEnv: ['/usr/bin', fallback].join(path.delimiter), fallbackPathEnv: fallback })).toBe(current);
    });

    it('knows a fallback folder however its end is written', () => {
      const current = cli(CLAUDE_CLI, '.local/bin/claude', '2.1.307 (Claude Code)');
      const old = cli(CLAUDE_CLI, 'homebrew/bin/claude', '2.1.63 (Claude Code)');

      expect(findAgentCli(CLAUDE_CLI, { home, pathEnv: path.dirname(old), fallbackPathEnv: `${path.dirname(old)}${path.sep}` })).toBe(current);
    });

    it('still finds a copy that only a fallback folder has', () => {
      const only = cli(CODEX_CLI, 'homebrew/bin/codex', 'codex-cli 0.163.0');
      const fallback = path.dirname(only);

      expect(findAgentCli(CODEX_CLI, { home, pathEnv: fallback, fallbackPathEnv: fallback })).toBe(only);
    });

    it('keeps the order of the PATH it has when no folder is a fallback, as in a terminal', () => {
      cli(CLAUDE_CLI, '.local/bin/claude', '2.1.307 (Claude Code)');
      const chosen = cli(CLAUDE_CLI, 'homebrew/bin/claude', '2.1.63 (Claude Code)');

      expect(findAgentCli(CLAUDE_CLI, { home, pathEnv: path.dirname(chosen), fallbackPathEnv: '' })).toBe(chosen);
    });
  });
});

describe('running a CLI found on Windows', () => {
  const npm = 'C:\\Users\\ada\\AppData\\Roaming\\npm';
  const win = { platform: 'win32' as const, exists: () => true, electron: false };

  it('runs the script behind an npm shim with Node, since only a shell runs the shim', () => {
    expect(agentCliTargetAt(CODEX_CLI, `${npm}\\codex.cmd`, win)).toEqual({
      kind: 'node',
      command: process.execPath,
      entry: `${npm}\\node_modules\\@openai\\codex\\bin\\codex.js`,
      env: {},
    });
    expect(agentCliTargetAt(CLAUDE_CLI, `${npm}\\claude.cmd`, { ...win, electron: true })).toEqual({
      kind: 'node',
      command: process.execPath,
      entry: `${npm}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`,
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
  });

  it("runs the program behind OpenCode's npm shim as it is", () => {
    expect(agentCliTargetAt(OPENCODE_CLI, `${npm}\\opencode.cmd`, win)).toEqual({
      kind: 'direct',
      command: `${npm}\\node_modules\\opencode-ai\\bin\\opencode.exe`,
    });
  });

  it('runs a native program as it is, and any CLI outside Windows', () => {
    expect(agentCliTargetAt(CODEX_CLI, 'C:\\Tools\\codex.exe', win)).toEqual({ kind: 'direct', command: 'C:\\Tools\\codex.exe' });
    expect(agentCliTargetAt(CODEX_CLI, '/usr/local/bin/codex', { platform: 'darwin' })).toEqual({ kind: 'direct', command: '/usr/local/bin/codex' });
  });

  it('refuses a shim whose program is gone, and a file Windows cannot run', () => {
    expect(() => agentCliTargetAt(CODEX_CLI, `${npm}\\codex.cmd`, { ...win, exists: () => false })).toThrow(/Cannot find .*codex\.js.*reinstall Codex/);
    expect(() => agentCliTargetAt(CODEX_CLI, `${npm}\\codex`, win)).toThrow(/Cannot run Codex from/);
  });
});

describe('checking a CLI', () => {
  const at = (latest: string | null) => checkAgentCli(CODEX_CLI, { home, pathEnv: '' }, { latest: async () => latest, now: () => 42 });

  it('says it is missing when it is not installed', async () => {
    newHome();
    expect(await at('0.162.1')).toEqual({ state: 'missing', command: 'codex', installed: null, latest: '0.162.1', minimum: '0.155.1', checkedAt: 42 });
  });

  it('asks for an update below the oldest version Moxxy works with', async () => {
    cli(CODEX_CLI, '.local/bin/codex', 'codex-cli 0.150.0');
    expect(await at('0.162.1')).toMatchObject({ state: 'update-required', installed: '0.150.0' });
  });

  it('offers an update when the vendor published a newer one', async () => {
    cli(CODEX_CLI, '.local/bin/codex', 'codex-cli 0.155.1');
    expect(await at('0.162.1')).toMatchObject({ state: 'update-available', installed: '0.155.1', latest: '0.162.1' });
  });

  it('is current at the latest, and when the registry cannot be asked', async () => {
    cli(CODEX_CLI, '.local/bin/codex', 'codex-cli 0.162.1');
    expect(await at('0.162.1')).toMatchObject({ state: 'current' });
    expect(await at(null)).toMatchObject({ state: 'current', latest: null });
  });

  it('says who the agent is signed in as, when asked', async () => {
    cli(CODEX_CLI, '.local/bin/codex', 'codex-cli 0.162.1');
    const signedIn = async () => ({ signedIn: true, account: 'ChatGPT' });
    const signedOut = async () => ({ signedIn: false });

    expect(await checkAgentCli(CODEX_CLI, { home, pathEnv: '' }, { latest: async () => null, signIn: signedIn })).toMatchObject({
      state: 'current',
      signedIn: true,
      account: 'ChatGPT',
    });
    expect(await checkAgentCli(CODEX_CLI, { home, pathEnv: '' }, { latest: async () => null, signIn: signedOut })).toMatchObject({
      signedIn: false,
      account: null,
    });
  });

  it('does not ask a missing CLI who it is signed in as', async () => {
    newHome();
    let asked = false;
    const report = await checkAgentCli(CODEX_CLI, { home, pathEnv: '' }, {
      latest: async () => null,
      signIn: async () => {
        asked = true;
        return { signedIn: true };
      },
    });

    expect(asked).toBe(false);
    expect(report).not.toHaveProperty('signedIn');
  });

  it.skipIf(process.platform === 'win32')('says which file it checked and where it came from', async () => {
    const cask = cli(CLAUDE_CLI, 'brew/Caskroom/claude-code/2.1.63/claude', '2.1.63 (Claude Code)');
    const file = linked('brew/bin/claude', cask);

    const report = await checkAgentCli(CLAUDE_CLI, { home, pathEnv: path.dirname(file) }, { latest: noRegistry });

    expect(report).toMatchObject({ state: 'update-required', installed: '2.1.63', path: file, origin: 'homebrew' });
  });

  it('cannot tell when the CLI prints no version', async () => {
    cli(CODEX_CLI, '.local/bin/codex', 'hello');
    expect(await at('0.162.1')).toMatchObject({ state: 'unknown', installed: null });
  });
});

describe("the vendor's latest version", () => {
  it('asks the registry at most once an hour, unless asked to look again', async () => {
    const cacheFile = path.join(newHome(), 'cache', 'agent-cli-latest.json');
    const asked: string[] = [];
    let now = 1_000;
    const opts = (refresh = false) => ({
      cacheFile,
      refresh,
      now: () => now,
      fetchLatest: async (pkg: string) => {
        asked.push(pkg);
        return '0.162.1';
      },
    });

    expect(await latestAgentVersion('@openai/codex', opts())).toBe('0.162.1');
    now += 59 * 60_000;
    expect(await latestAgentVersion('@openai/codex', opts())).toBe('0.162.1');
    expect(asked).toEqual(['@openai/codex']);
    now += 2 * 60_000;
    await latestAgentVersion('@openai/codex', opts());
    await latestAgentVersion('@openai/codex', opts(true));
    expect(asked).toHaveLength(3);
    expect(JSON.parse(readFileSync(cacheFile, 'utf8'))).toMatchObject({ '@openai/codex': { version: '0.162.1' } });
  });

  it('keeps the last answer when the registry cannot be reached', async () => {
    const cacheFile = path.join(newHome(), 'cache', 'agent-cli-latest.json');
    await latestAgentVersion('opencode-ai', { cacheFile, now: () => 0, fetchLatest: async () => '1.19.0' });

    expect(await latestAgentVersion('opencode-ai', { cacheFile, refresh: true, now: () => 0, fetchLatest: noRegistry })).toBe('1.19.0');
    expect(await latestAgentVersion('opencode-ai', { cacheFile: path.join(home ?? '', 'none.json'), fetchLatest: noRegistry })).toBeNull();
  });
});

/** `link` pointing at `target`, both under the home, as installers and Homebrew leave them. */
function linked(link: string, target: string): string {
  const at = path.join(home ?? newHome(), ...link.split('/'));
  mkdirSync(path.dirname(at), { recursive: true });
  symlinkSync(target, at);
  return at;
}

const asIs = (file: string): string => file;

describe('where a CLI came from', () => {
  describe.skipIf(process.platform === 'win32')('on this computer', () => {
    it("is the vendor's installer for the copy it put in its folder", () => {
      const version = cli(CLAUDE_CLI, '.local/share/claude/versions/2.1.307', '2.1.307 (Claude Code)');
      const file = linked('.local/bin/claude', version);

      expect(agentCliOrigin(CLAUDE_CLI, file, { home })).toEqual({ origin: 'installer' });
    });

    it('is Homebrew for a cask or a formula, with its folder and name', () => {
      const cask = cli(CLAUDE_CLI, 'brew/Caskroom/claude-code/2.1.63/claude', '2.1.63 (Claude Code)');
      const formula = cli(OPENCODE_CLI, 'brew/Cellar/opencode/1.19.0/bin/opencode', '1.19.0');
      const prefix = path.join(realpathSync(home!), 'brew');

      expect(agentCliOrigin(CLAUDE_CLI, linked('brew/bin/claude', cask), { home })).toEqual({
        origin: 'homebrew',
        homebrew: { prefix, name: 'claude-code', cask: true },
      });
      expect(agentCliOrigin(OPENCODE_CLI, linked('brew/bin/opencode', formula), { home })).toEqual({
        origin: 'homebrew',
        homebrew: { prefix, name: 'opencode', cask: false },
      });
    });

    it('is npm for a global npm install of the vendor’s package', () => {
      const script = cli(CODEX_CLI, 'npm/lib/node_modules/@openai/codex/bin/codex.js', 'codex-cli 0.163.0');

      expect(agentCliOrigin(CODEX_CLI, linked('npm/bin/codex', script), { home })).toEqual({ origin: 'npm' });
    });

    it('is unknown for anything else', () => {
      expect(agentCliOrigin(CLAUDE_CLI, cli(CLAUDE_CLI, 'tools/claude', '2.1.307 (Claude Code)'), { home })).toEqual({ origin: 'unknown' });
    });
  });

  it('is an app for a copy inside a macOS app, which updates with that app', () => {
    const inside = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';

    expect(agentCliOrigin(CODEX_CLI, inside, { home: '/Users/me', platform: 'darwin', realpath: asIs })).toEqual({ origin: 'app', app: 'ChatGPT.app' });
    expect(agentCliOrigin(CODEX_CLI, inside, { home: '/home/me', platform: 'linux', realpath: asIs })).toEqual({ origin: 'unknown' });
  });

  it('reads Windows paths the same way', () => {
    const options = { home: 'C:\\Users\\me', platform: 'win32' as const, realpath: asIs };

    expect(agentCliOrigin(CLAUDE_CLI, 'C:\\Users\\me\\.local\\bin\\claude.exe', options)).toEqual({ origin: 'installer' });
    expect(agentCliOrigin(CLAUDE_CLI, 'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js', options)).toEqual({ origin: 'npm' });
    expect(agentCliOrigin(CLAUDE_CLI, 'c:\\users\\ME\\.LOCAL\\bin\\claude.exe', options)).toEqual({ origin: 'installer' });
  });
});

// Windows runs installers through PowerShell, which can take seconds to start on CI.
const INSTALL_TIMEOUT_MS = 30_000;

describe('installing and updating a CLI', () => {
  const fake = (installer: string): AgentCliDescriptor => ({
    ...OPENCODE_CLI,
    install: fakeInstaller(home ?? newHome(), installer),
  });

  it("runs the vendor's installer, reporting each line and how far it got", async () => {
    newHome();
    const lines: string[] = [];
    const progress: Array<number | null> = [];
    const script = [
      "process.stdout.write('Installing opencode\\n');",
      "process.stdout.write('\\x1b[0;2m####   40.0%\\r');",
      "process.stdout.write('######## 100.0%\\n');",
      "console.log('Installed');",
    ].join('\n');

    const result = await runAgentCliAction(fake(script), 'install', {
      home,
      onLine: (line) => lines.push(line),
      onProgress: (fraction) => progress.push(fraction),
    });

    expect(result).toEqual({ ok: true, message: 'Installed' });
    expect(lines).toEqual(['Installing opencode', '####   40.0%', '######## 100.0%', 'Installed']);
    expect(progress).toEqual([0.4, 1]);
   }, INSTALL_TIMEOUT_MS);

  it('says why an install failed', async () => {
    newHome();
    const result = await runAgentCliAction(fake("console.log('Downloading'); console.error('curl: (6) Could not resolve host'); process.exit(6);"), 'install', {
      home,
    });

    expect(result).toEqual({ ok: false, message: 'curl: (6) Could not resolve host' });
   }, INSTALL_TIMEOUT_MS);

  it("updates through the agent's own command, wherever it was found", async () => {
    const updated = path.join(newHome(), 'updated');
    cli(CODEX_CLI, '.local/bin/codex', 'codex-cli 0.155.1', `if (args[0] === 'update') { console.log('Updated to 0.162.1'); require('fs').writeFileSync(${JSON.stringify(updated)}, ''); }`);

    const result = await runAgentCliAction(CODEX_CLI, 'update', { home, pathEnv: '' });

    expect(result).toEqual({ ok: true, message: 'Updated to 0.162.1' });
    expect(existsSync(updated)).toBe(true);
  });

  describe.skipIf(process.platform === 'win32')('a copy that did not come from the vendor’s installer', () => {
    /** A Homebrew cask of Claude under the home, and the file its `brew` writes its arguments to. */
    function brewClaude(withBrew: boolean): { readonly ran: string; readonly updated: string } {
      const ran = path.join(newHome(), 'brew-ran');
      const updated = path.join(home!, 'claude-updated');
      const cask = cli(CLAUDE_CLI, 'brew/Caskroom/claude-code/2.1.63/claude', '2.1.63 (Claude Code)', `if (args[0] === 'update') { console.log('Updated'); require('fs').writeFileSync(${JSON.stringify(updated)}, ''); }`);
      linked('brew/bin/claude', cask);
      if (withBrew) {
        writeFakeCli(path.join(home!, 'brew', 'bin', 'brew'), `require('fs').writeFileSync(${JSON.stringify(ran)}, args.join(' ')); console.log('Upgraded claude-code');`);
      }
      return { ran, updated };
    }

    it('updates a Homebrew copy with the Homebrew it belongs to', async () => {
      const { ran, updated } = brewClaude(true);

      const result = await runAgentCliAction(CLAUDE_CLI, 'update', { home, pathEnv: path.join(home!, 'brew', 'bin') });

      expect(result).toEqual({ ok: true, message: 'Upgraded claude-code' });
      expect(readFileSync(ran, 'utf8')).toBe('upgrade --cask claude-code');
      expect(existsSync(updated)).toBe(false);
    });

    it("uses the agent's own update when that Homebrew is not there", async () => {
      const { updated } = brewClaude(false);

      const result = await runAgentCliAction(CLAUDE_CLI, 'update', { home, pathEnv: path.join(home!, 'brew', 'bin') });

      expect(result).toEqual({ ok: true, message: 'Updated' });
      expect(existsSync(updated)).toBe(true);
    });

    it('runs nothing for a copy inside an app, which updates with that app', async () => {
      const updated = path.join(newHome(), 'updated');
      const inside = cli(CODEX_CLI, 'Apps/ChatGPT.app/Contents/Resources/codex-cli/bin/codex', 'codex-cli 0.150.0', `require('fs').writeFileSync(${JSON.stringify(updated)}, '');`);

      const result = await runAgentCliAction(CODEX_CLI, 'update', { home, platform: 'darwin', pathEnv: path.dirname(inside) });

      expect(result).toEqual({ ok: false, message: `The Codex at ${inside} is part of ChatGPT.app and updates with it.` });
      expect(existsSync(updated)).toBe(false);
    });
  });

  it('cannot update what is not installed', async () => {
    newHome();
    expect(await runAgentCliAction(CODEX_CLI, 'update', { home, pathEnv: '' })).toEqual({
      ok: false,
      message: 'Codex is not installed.',
    });
  });

  it('stops when told to', async () => {
    newHome();
    const stop = new AbortController();
    const running = runAgentCliAction(fake("console.log('started'); setTimeout(() => {}, 30_000);"), 'install', {
      home,
      signal: stop.signal,
      onLine: () => stop.abort(),
    });

    expect(await running).toEqual({ ok: false, message: 'Stopped.' });
   }, INSTALL_TIMEOUT_MS);
});
