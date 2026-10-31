/**
 * The agent CLIs Moxxy connects to: where each one lives, whether it is new
 * enough, and installing or updating it with the vendor's own commands. The
 * CLIs here are real executables in a temporary home; only the npm registry
 * is stood in for.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
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
  agentCliUpdatePlan,
  agentVersionSource,
  checkAgentCli,
  findAgentCli,
  installInvocation,
  latestAgentVersion,
  runAgentCliAction,
  updaterEnv,
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
      ['opencode', '@opencode/cli', '1.19.0', 'OPENCODE_EXECUTABLE'],
    ]);
  });

  it("updates each with the agent's own command, which knows how it was installed", () => {
    expect(CLAUDE_CLI.updateArgs).toEqual(['update']);
    expect(CODEX_CLI.updateArgs).toEqual(['update']);
    expect(OPENCODE_CLI.updateArgs).toEqual(['upgrade']);
    expect(OPENCODE_CLI.majorUpdateArgs).toEqual(['upgrade', '--major']);
  });

  it("installs each with the vendor's installer, on Windows through PowerShell", () => {
    expect(installInvocation(CLAUDE_CLI, 'darwin')).toEqual({
      command: '/bin/sh',
      args: ['-c', 'curl -fsSL https://claude.ai/install.sh | bash'],
    });
    expect(installInvocation(CODEX_CLI, 'linux').args[1]).toBe('curl -fsSL https://chatgpt.com/codex/install.sh | sh');
    expect(installInvocation(OPENCODE_CLI, 'linux').args[1]).toBe('curl -fsSL https://opencode.ai/v2/install | bash');
    expect(installInvocation(CODEX_CLI, 'win32')).toEqual({
      command: expect.stringMatching(/\\WindowsPowerShell\\v1\.0\\powershell\.exe$/),
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://chatgpt.com/codex/install.ps1 | iex'],
    });
    expect(installInvocation(OPENCODE_CLI, 'win32').args.at(-1)).toBe('npm install -g @opencode/cli');
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

  it("starts Codex's own codex.exe behind the npm shim, so Windows opens no console window for it", () => {
    const codexPackage = `${npm}\\node_modules\\@openai\\codex`;
    const exe = `${codexPackage}\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe`;
    expect(agentCliTargetAt(CODEX_CLI, `${npm}\\codex.cmd`, { ...win, arch: 'x64', exists: (file) => file === exe })).toEqual({
      kind: 'direct',
      command: exe,
      env: { CODEX_MANAGED_BY_NPM: '1', CODEX_MANAGED_PACKAGE_ROOT: codexPackage },
    });
  });

  it('finds the codex.exe npm placed beside Codex, and the one for ARM', () => {
    const exe = `${npm}\\node_modules\\@openai\\codex-win32-arm64\\vendor\\aarch64-pc-windows-msvc\\bin\\codex.exe`;
    expect(agentCliTargetAt(CODEX_CLI, `${npm}\\codex.cmd`, { ...win, arch: 'arm64', exists: (file) => file === exe })).toMatchObject({
      kind: 'direct',
      command: exe,
    });
  });

  it('runs the script behind an npm shim with Node when its program is not there, since only a shell runs the shim', () => {
    const scriptsOnly = { ...win, exists: (file: string) => !file.endsWith('.exe') };
    expect(agentCliTargetAt(CODEX_CLI, `${npm}\\codex.cmd`, scriptsOnly)).toEqual({
      kind: 'node',
      command: process.execPath,
      entry: `${npm}\\node_modules\\@openai\\codex\\bin\\codex.js`,
      env: {},
    });
    expect(agentCliTargetAt(CLAUDE_CLI, `${npm}\\claude.cmd`, { ...scriptsOnly, electron: true })).toEqual({
      kind: 'node',
      command: process.execPath,
      entry: `${npm}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`,
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
  });

  it("runs the program behind OpenCode 1's npm shim as it is", () => {
    const exe = `${npm}\\node_modules\\opencode-ai\\bin\\opencode.exe`;
    expect(agentCliTargetAt(OPENCODE_CLI, `${npm}\\opencode.cmd`, { ...win, exists: (file) => file === exe })).toEqual({
      kind: 'direct',
      command: `${npm}\\node_modules\\opencode-ai\\bin\\opencode.exe`,
    });
  });

  it('runs the program behind the npm shim of OpenCode 2, published as @opencode/cli', () => {
    const exe = `${npm}\\node_modules\\@opencode\\cli\\bin\\opencode.exe`;
    expect(agentCliTargetAt(OPENCODE_CLI, `${npm}\\opencode.cmd`, { ...win, exists: (file) => file === exe })).toEqual({
      kind: 'direct',
      command: exe,
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

      expect(agentCliOrigin(CODEX_CLI, linked('npm/bin/codex', script), { home })).toMatchObject({ origin: 'npm' });
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

  it('asks npm about OpenCode 2, published as @opencode/cli, and knows its global npm install', () => {
    const options = { home: 'C:\\Users\\me', platform: 'win32' as const, realpath: asIs };
    const exe = 'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@opencode\\cli\\bin\\opencode.exe';

    expect(OPENCODE_CLI.npmPackage).toBe('@opencode/cli');
    expect(agentCliOrigin(OPENCODE_CLI, exe, options)).toEqual({ origin: 'npm' });
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

  describe("the PATH an agent's own update runs with", () => {
    const saved = process.env.PATH;
    afterEach(() => {
      process.env.PATH = saved;
    });

    /** A Codex under the home whose `update` reports the first and last folder of its PATH. */
    function pathReportingCodex(relative: string): string {
      const report = [
        "const entry = Object.entries(process.env).find(([key]) => key.toUpperCase() === 'PATH');",
        "const dirs = (entry ? entry[1] : '').split(require('path').delimiter).filter(Boolean);",
        "console.log(`first=${dirs[0]} last=${dirs[dirs.length - 1]}`);",
      ].join('\n');
      return cli(CODEX_CLI, relative, 'codex-cli 0.163.0', `if (args[0] === 'update') { ${report} }`);
    }

    it("puts the host's own folders last, so the agent's updater finds the npm that installed the agent, not the host's", async () => {
      const hostNode = path.join(newHome(), 'host-node');
      mkdirSync(hostNode, { recursive: true });
      pathReportingCodex('.local/bin/codex');
      process.env.PATH = [hostNode, saved].join(path.delimiter);

      const result = await runAgentCliAction(CODEX_CLI, 'update', { home, pathEnv: '', hostPathDirs: [hostNode] });

      expect(result.ok).toBe(true);
      expect(result.message).not.toContain(`first=${hostNode} `);
      expect(result.message).toContain(`last=${hostNode}`);
    });

    it("keeps them first for an agent installed in one of them, whose npm that is", async () => {
      const hostNode = path.join(newHome(), 'host-node');
      pathReportingCodex('host-node/codex');
      process.env.PATH = [hostNode, saved].join(path.delimiter);

      const result = await runAgentCliAction(CODEX_CLI, 'update', { home, pathEnv: hostNode, hostPathDirs: [hostNode] });

      expect(result.ok).toBe(true);
      expect(result.message).toContain(`first=${hostNode} `);
    });
  });

  describe('the PATH it computes on each system', () => {
    it('moves the host folders last on macOS and Linux, and leaves a PATH without them alone', () => {
      const env = { PATH: '/app/node/bin:/opt/homebrew/bin:/usr/bin' };
      expect(updaterEnv('/opt/homebrew/bin/opencode', ['/app/node/bin'], env, 'darwin')).toEqual({ PATH: '/opt/homebrew/bin:/usr/bin:/app/node/bin' });
      expect(updaterEnv('/usr/local/bin/codex', ['/app/node/bin'], { PATH: '/usr/bin' }, 'linux')).toEqual({});
      expect(updaterEnv('/app/node/bin/codex', ['/app/node/bin'], env, 'linux')).toEqual({});
    });

    it("keeps Windows' own name for the variable and compares folders as Windows does", () => {
      const env = { Path: 'C:\\Moxxy\\node;C:\\Users\\me\\AppData\\Roaming\\npm;C:\\Program Files\\nodejs' };
      expect(updaterEnv('C:\\Users\\me\\AppData\\Roaming\\npm\\opencode.cmd', ['c:\\moxxy\\NODE'], env, 'win32')).toEqual({
        Path: 'C:\\Users\\me\\AppData\\Roaming\\npm;C:\\Program Files\\nodejs;C:\\Moxxy\\node',
      });
      expect(updaterEnv('C:\\Moxxy\\node\\codex.cmd', ['C:\\Moxxy\\node'], env, 'win32')).toEqual({});
    });
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

  describe('an OpenCode a major release behind', () => {
    // This external CLI stand-in is a Node script on every OS. Native OpenCode
    // .exe resolution is covered separately in "running a CLI found on Windows".
    const testCli: AgentCliDescriptor = {
      ...OPENCODE_CLI,
      windowsShim: { entry: 'node_modules/opencode-test/cli.cjs', runs: 'node' },
    };
    // OpenCode 1's `upgrade` stays on 1 ("skipped: 1.19.4 is already installed");
    // `upgrade --major` swaps the install for OpenCode 2 the way it was installed.
    const opencode = (version: string) =>
      cli(
        testCli,
        '.opencode/bin/opencode',
        version,
        "if (args.join(' ') === 'upgrade --major') console.log('OpenCode 2 installed'); else console.log(`opencode upgrade skipped: ${args.join(' ')}`);",
      );

    it('moves to the next major release with OpenCode own command for it', async () => {
      newHome();
      opencode('1.19.4');

      const result = await runAgentCliAction(testCli, 'update', { home, pathEnv: '', latest: async () => '2.1.4' });

      expect(result).toEqual({ ok: true, message: 'OpenCode 2 installed' });
    });

    it('updates within its major release as before', async () => {
      newHome();
      opencode('2.0.28');

      const result = await runAgentCliAction(testCli, 'update', { home, pathEnv: '', latest: async () => '2.1.4' });

      expect(result).toEqual({ ok: true, message: 'opencode upgrade skipped: upgrade' });
    });

    it('updates as before when the latest release cannot be read', async () => {
      newHome();
      opencode('1.19.4');

      const result = await runAgentCliAction(testCli, 'update', { home, pathEnv: '', latest: noRegistry });

      expect(result).toEqual({ ok: true, message: 'opencode upgrade skipped: upgrade' });
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

describe('the source of the newest version an install can get', () => {
  const answer = (body: string): typeof fetch => (async () => new Response(body)) as typeof fetch;

  it("asks Anthropic's channel for a copy from its installer, not npm", async () => {
    newHome();
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return new Response('2.1.314\n');
    }) as typeof fetch;

    const source = agentVersionSource(CLAUDE_CLI, { origin: 'installer' }, { home, fetchImpl });

    expect(await source.fetch()).toBe('2.1.314');
    expect(urls).toEqual(['https://downloads.claude.ai/claude-code-releases/latest']);
  });

  it('follows the channel the person set in Claude', async () => {
    newHome();
    mkdirSync(path.join(home!, '.claude'));
    writeFileSync(path.join(home!, '.claude', 'settings.json'), '{"autoUpdatesChannel":"stable"}');
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return new Response('2.1.308');
    }) as typeof fetch;

    await agentVersionSource(CLAUDE_CLI, { origin: 'installer' }, { home, fetchImpl }).fetch();

    expect(urls).toEqual(['https://downloads.claude.ai/claude-code-releases/stable']);
  });

  it('asks Homebrew for a Homebrew copy', async () => {
    const homebrew = { prefix: '/opt/homebrew', name: 'claude-code', cask: true };

    const source = agentVersionSource(CLAUDE_CLI, { origin: 'homebrew', homebrew }, { fetchImpl: answer('{"version":"2.1.308"}') });

    expect(await source.fetch()).toBe('2.1.308');
  });

  it('asks winget for a winget copy, in any language', async () => {
    const run = async () => 'Znaleziono Anthropic Claude Code [Anthropic.ClaudeCode]\nWersja: 2.1.302\nWydawca: Anthropic\n';

    const source = agentVersionSource(CLAUDE_CLI, { origin: 'winget', winget: { id: 'Anthropic.ClaudeCode' } }, { run });

    expect(await source.fetch()).toBe('2.1.302');
  });

  it('keeps npm for an npm copy', () => {
    expect(agentVersionSource(CLAUDE_CLI, { origin: 'npm' }).key).toBe('@anthropic-ai/claude-code');
  });

  it('knows a copy winget installed', () => {
    const file = 'C:\\Users\\M\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe\\claude.exe';

    expect(agentCliOrigin(CLAUDE_CLI, file, { platform: 'win32', realpath: (f) => f })).toEqual({
      origin: 'winget',
      winget: { id: 'Anthropic.ClaudeCode' },
    });
  });

  it('offers no update the source does not have', async () => {
    newHome();
    cli(CLAUDE_CLI, '.local/bin/claude', '2.1.314');
    const cacheFile = path.join(home!, 'latest.json');
    const fetchImpl = answer('2.1.314');

    const report = await checkAgentCli(CLAUDE_CLI, { home, pathEnv: '', refresh: true, cacheFile, fetchImpl });

    expect(report).toMatchObject({ state: 'current', latest: '2.1.314' });
  });

  it('stops offering a version an update could not bring', async () => {
    newHome();
    const file = cli(CODEX_CLI, 'tools/codex', '0.166.0', "console.log('Already up to date')");
    const cacheFile = path.join(home!, 'latest.json');
    const fetchImpl = (async () => Response.json({ version: '0.167.0' })) as typeof fetch;
    const search = { home, pathEnv: path.dirname(file), cacheFile, fetchImpl };
    expect(await checkAgentCli(CODEX_CLI, { ...search, refresh: true })).toMatchObject({ state: 'update-available' });

    await runAgentCliAction(CODEX_CLI, 'update', search);

    expect(await checkAgentCli(CODEX_CLI, { ...search, refresh: true })).toMatchObject({ state: 'current' });
  });
});

describe('an OpenCode too old for --major', () => {
  it('takes the plain upgrade first', async () => {
    newHome();
    // OpenCode on Windows is a native program; this stand-in is a Node script, so it says so.
    const testCli: AgentCliDescriptor = {
      ...OPENCODE_CLI,
      windowsShim: { entry: 'node_modules/opencode-test/cli.cjs', runs: 'node' },
    };
    cli(testCli, '.opencode/bin/opencode', '1.18.34', "console.log(args.join(' '))");

    const result = await runAgentCliAction(testCli, 'update', { home, pathEnv: '', latest: async () => '2.2.5' });

    expect(result).toEqual({ ok: true, message: 'upgrade' });
  });
});

describe('an update that would wait forever', () => {
  // OpenCode on Windows is a native program; this stand-in is a Node script, so it says so.
  const testCli: AgentCliDescriptor = { ...OPENCODE_CLI, windowsShim: { entry: 'node_modules/opencode-test/cli.cjs', runs: 'node' } };

  it('stops at a question nobody can answer and says so', async () => {
    newHome();
    cli(testCli, '.opencode/bin/opencode', '2.2.5', "process.stdout.write('Install anyways? '); setTimeout(() => {}, 30_000);");

    const result = await runAgentCliAction(testCli, 'update', { home, pathEnv: '', latest: noRegistry });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Install anyways?');
  });

  it('quotes the question, not the rest of the prompt drawn after it', async () => {
    newHome();
    const prompt = '│\\n◆  Install anyways?\\n│  ○ Yes\\n│  ● No\\n└\\n';
    cli(testCli, '.opencode/bin/opencode', '2.2.5', `process.stdout.write('${prompt}'); setTimeout(() => {}, 30_000);`);

    const result = await runAgentCliAction(testCli, 'update', { home, pathEnv: '', latest: noRegistry });

    expect(result.message).toBe('It asked to confirm, and Moxxy cannot answer: "Install anyways?" Run the update in a terminal.');
  });

  it('stops one that goes silent', async () => {
    newHome();
    cli(testCli, '.opencode/bin/opencode', '2.2.5', 'setTimeout(() => {}, 30_000);');

    const result = await runAgentCliAction(testCli, 'update', { home, pathEnv: '', latest: noRegistry, silenceLimitMs: 200 });

    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('nothing printed') });
  });
});

describe('the way a copy is updated', () => {
  const plan = (desc: AgentCliDescriptor, file: string, platform: NodeJS.Platform = 'darwin') => {
    const options = { platform, realpath: (f: string) => f, home: '/Users/me' };
    return agentCliUpdatePlan(desc, file, agentCliOrigin(desc, file, options), platform);
  };

  it.each([
    ['/Users/me/.bun/bin/claude', 'bun', ['i', '-g', '@anthropic-ai/claude-code@latest']],
    ['/Users/me/Library/pnpm/global/5/node_modules/x/claude', 'pnpm', ['add', '-g', '@anthropic-ai/claude-code@latest']],
    ['/Users/me/.config/yarn/global/node_modules/.bin/claude', 'yarn', ['global', 'add', '@anthropic-ai/claude-code@latest']],
    ['/Users/me/.volta/bin/claude', 'volta', ['install', '@anthropic-ai/claude-code@latest']],
    ['/Users/me/.vite-plus/bin/claude', 'vp', ['i', '-g', '@anthropic-ai/claude-code']],
  ])('updates %s with the tool that owns it', (file, command, args) => {
    expect(plan(CLAUDE_CLI, file)).toMatchObject({ kind: 'run', command, args });
  });

  it('updates a global npm install inside its own prefix', () => {
    const file = '/opt/homebrew/Cellar/node/24.0.0/lib/node_modules/@anthropic-ai/claude-code/cli.js';

    expect(plan(CLAUDE_CLI, file)).toMatchObject({
      kind: 'run',
      command: 'npm',
      args: [
        'install',
        '-g',
        '--prefix',
        '/opt/homebrew/Cellar/node/24.0.0',
        '--allow-scripts=@anthropic-ai/claude-code',
        '@anthropic-ai/claude-code@latest',
      ],
    });
  });

  it('leaves a copy mise owns to mise', () => {
    expect(plan(CLAUDE_CLI, '/Users/me/.local/share/mise/installs/claude/2.1.0/bin/claude').kind).toBe('manual');
  });

  it('keeps a node global under mise with npm', () => {
    const file = '/Users/me/.local/share/mise/installs/node/24/lib/node_modules/@anthropic-ai/claude-code/cli.js';

    expect(plan(CLAUDE_CLI, file)).toMatchObject({ kind: 'run', command: 'npm' });
  });

  it('leaves a project copy alone, since the agent could update the wrong install', () => {
    expect(plan(CLAUDE_CLI, '/Users/me/app/node_modules/.bin/claude').kind).toBe('manual');
  });

  it("uses the agent's own command for the copy its installer put in place", () => {
    expect(plan(CLAUDE_CLI, '/Users/me/.local/bin/claude').kind).toBe('own');
  });

  it("keeps OpenCode 1's npm package on OpenCode's own upgrade", () => {
    expect(plan(OPENCODE_CLI, '/Users/me/.nvm/lib/node_modules/opencode-ai/bin/opencode').kind).toBe('own');
  });

  it('gives Windows the command to paste, since its package managers are shims', () => {
    const update = plan(CLAUDE_CLI, 'C:\\Users\\me\\AppData\\Local\\pnpm\\claude.cmd', 'win32');

    expect(update).toMatchObject({ kind: 'manual', hint: 'run pnpm add -g @anthropic-ai/claude-code@latest' });
  });

  it('runs the owner, and tells the check a copy needs a hand update', async () => {
    newHome();
    const bin = path.join(home!, '.bun', 'bin');
    mkdirSync(bin, { recursive: true });
    writeFakeCli(path.join(bin, 'bun'), "console.log('bun', args.join(' '));", { windowsEntry: 'x.cjs' });
    cli(CLAUDE_CLI, '.bun/bin/claude', '2.1.300');

    const result = await runAgentCliAction(CLAUDE_CLI, 'update', { home, pathEnv: bin });

    expect(result).toEqual({ ok: true, message: 'bun i -g @anthropic-ai/claude-code@latest' });
  });
});
