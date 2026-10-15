/**
 * The agent CLIs Moxxy connects to: where each one lives, whether it is new
 * enough, and installing or updating it with the vendor's own commands. The
 * CLIs here are real executables in a temporary home; only the npm registry
 * is stood in for.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeDirSync } from '@moxxy/vitest-preset/fs';
import {
  AGENT_CLIS,
  CLAUDE_CLI,
  CODEX_CLI,
  OPENCODE_CLI,
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

/** A CLI at `relative` under the home that prints `version` for `--version` and runs `script` otherwise. */
function cli(relative: string, version: string, script = ''): string {
  const file = path.join(home ?? newHome(), relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `#!/bin/sh\nif [ "$1" = "--version" ]; then printf '%s\\n' ${JSON.stringify(version)}; exit 0; fi\n${script}\n`);
  chmodSync(file, 0o755);
  return file;
}

const noRegistry = async (): Promise<string | null> => null;

describe('the agent CLIs Moxxy knows', () => {
  it('names each by its connection, with the oldest version Moxxy was checked against', () => {
    expect(AGENT_CLIS['claude-code']).toBe(CLAUDE_CLI);
    expect(AGENT_CLIS['codex-agent']).toBe(CODEX_CLI);
    expect(AGENT_CLIS.opencode).toBe(OPENCODE_CLI);
    expect([CLAUDE_CLI, CODEX_CLI, OPENCODE_CLI].map((d) => [d.command, d.npmPackage, d.minimumVersion])).toEqual([
      ['claude', '@anthropic-ai/claude-code', '2.1.296'],
      ['codex', '@openai/codex', '0.155.1'],
      ['opencode', 'opencode-ai', '1.19.0'],
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
    const file = cli('.opencode/bin/opencode', '1.19.0');

    expect(findAgentCli(OPENCODE_CLI, { home, pathEnv: '' })).toBe(file);
  });

  it('prefers the one on PATH, as a terminal would', () => {
    cli('.local/bin/codex', 'codex-cli 0.150.0');
    const onPath = cli('tools/codex', 'codex-cli 0.162.1');

    expect(findAgentCli(CODEX_CLI, { home, pathEnv: path.dirname(onPath) })).toBe(onPath);
  });

  it('finds nothing when there is nothing', () => {
    expect(findAgentCli(CLAUDE_CLI, { home: newHome(), pathEnv: '' })).toBeNull();
  });
});

describe('checking a CLI', () => {
  const at = (latest: string | null) => checkAgentCli(CODEX_CLI, { home, pathEnv: '' }, { latest: async () => latest, now: () => 42 });

  it('says it is missing when it is not installed', async () => {
    newHome();
    expect(await at('0.162.1')).toEqual({ state: 'missing', command: 'codex', installed: null, latest: '0.162.1', minimum: '0.155.1', checkedAt: 42 });
  });

  it('asks for an update below the oldest version Moxxy works with', async () => {
    cli('.local/bin/codex', 'codex-cli 0.150.0');
    expect(await at('0.162.1')).toMatchObject({ state: 'update-required', installed: '0.150.0' });
  });

  it('offers an update when the vendor published a newer one', async () => {
    cli('.local/bin/codex', 'codex-cli 0.155.1');
    expect(await at('0.162.1')).toMatchObject({ state: 'update-available', installed: '0.155.1', latest: '0.162.1' });
  });

  it('is current at the latest, and when the registry cannot be asked', async () => {
    cli('.local/bin/codex', 'codex-cli 0.162.1');
    expect(await at('0.162.1')).toMatchObject({ state: 'current' });
    expect(await at(null)).toMatchObject({ state: 'current', latest: null });
  });

  it('says who the agent is signed in as, when asked', async () => {
    cli('.local/bin/codex', 'codex-cli 0.162.1');
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

  it('cannot tell when the CLI prints no version', async () => {
    cli('.local/bin/codex', 'hello');
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

describe('installing and updating a CLI', () => {
  const fake = (install: string): AgentCliDescriptor => ({
    ...OPENCODE_CLI,
    install: { posix: install, windows: install },
  });

  it("runs the vendor's installer, reporting each line and how far it got", async () => {
    newHome();
    const lines: string[] = [];
    const progress: Array<number | null> = [];
    const script = "printf 'Installing opencode\\n'; printf '\\033[0;2m####   40.0%%\\r'; printf '######## 100.0%%\\n'; echo 'Installed'";

    const result = await runAgentCliAction(fake(script), 'install', {
      home,
      onLine: (line) => lines.push(line),
      onProgress: (fraction) => progress.push(fraction),
    });

    expect(result).toEqual({ ok: true, message: 'Installed' });
    expect(lines).toEqual(['Installing opencode', '####   40.0%', '######## 100.0%', 'Installed']);
    expect(progress).toEqual([0.4, 1]);
  });

  it('says why an install failed', async () => {
    newHome();
    const result = await runAgentCliAction(fake("echo 'Downloading'; echo 'curl: (6) Could not resolve host' >&2; exit 6"), 'install', {
      home,
    });

    expect(result).toEqual({ ok: false, message: 'curl: (6) Could not resolve host' });
  });

  it("updates through the agent's own command, wherever it was found", async () => {
    const file = cli('.opencode/bin/opencode', '1.18.0', 'if [ "$1" = "upgrade" ]; then echo "Upgraded to 1.19.0"; touch "$0.upgraded"; fi');

    const result = await runAgentCliAction(OPENCODE_CLI, 'update', { home, pathEnv: '' });

    expect(result).toEqual({ ok: true, message: 'Upgraded to 1.19.0' });
    expect(existsSync(`${file}.upgraded`)).toBe(true);
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
    const running = runAgentCliAction(fake('echo started; sleep 30'), 'install', {
      home,
      signal: stop.signal,
      onLine: () => stop.abort(),
    });

    expect(await running).toEqual({ ok: false, message: 'Stopped.' });
  });
});
