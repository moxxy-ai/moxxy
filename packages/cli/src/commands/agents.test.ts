/**
 * `moxxy agents`: where the Claude, Codex and OpenCode CLIs stand, and
 * installing or updating one. The CLIs are real executables in a temporary
 * home; only the npm registry is stood in for.
 */
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeInstaller, writeFakeCli } from '@moxxy/vitest-preset/fake-cli';
import { removeDirSync } from '@moxxy/vitest-preset/fs';
import { AGENT_CLIS, OPENCODE_CLI, type AgentCliDescriptor } from '@moxxy/agent-connection-kit';
import { parseArgv } from '../argv.js';
import { runAgentsCommand, type AgentsDeps } from './agents.js';

let home: string | undefined;
afterEach(() => {
  if (home) removeDirSync(home);
  home = undefined;
});

function newHome(): string {
  home = mkdtempSync(path.join(tmpdir(), 'moxxy-agents-cmd-'));
  return home;
}

// npm's OpenCode on Windows is a native opencode.exe behind its shim; the
// stand-in is a Node script, so it says so.
const OPENCODE: AgentCliDescriptor = {
  ...OPENCODE_CLI,
  windowsShim: { entry: 'node_modules/opencode-ai/bin/opencode.cjs', runs: 'node' },
};

/** A CLI at `relative` under the home that prints `version` for `--version` and runs `script` (Node, `args` in scope) otherwise. */
function cli(command: 'claude' | 'codex' | 'opencode', relative: string, version: string, script = ''): string {
  const desc = command === 'opencode' ? OPENCODE : Object.values(AGENT_CLIS).find((agent) => agent.command === command);
  if (!desc) throw new Error(`no agent CLI ${command}`);
  const file = path.join(home ?? newHome(), ...relative.split('/'));
  return writeFakeCli(file, `if (args[0] === '--version') { console.log(${JSON.stringify(version)}); process.exit(0); }\n${script}`, {
    windowsEntry: desc.windowsShim.entry,
  });
}

const LATEST: Record<string, string> = {
  '@anthropic-ai/claude-code': '2.1.300',
  '@openai/codex': '0.162.1',
  'opencode-ai': '1.19.2',
};

function run(args: string[], over: Partial<AgentsDeps> = {}) {
  let out = '';
  let err = '';
  const deps: AgentsDeps = {
    home: home ?? newHome(),
    pathEnv: '',
    agents: { opencode: OPENCODE },
    latest: async (pkg) => LATEST[pkg] ?? null,
    out: (s) => {
      out += s;
    },
    err: (s) => {
      err += s;
    },
    ...over,
  };
  return runAgentsCommand(parseArgv(['agents', ...args]), deps).then((code) => ({ code, out, err }));
}

describe('moxxy agents status', () => {
  it('lists each agent with its version and what to do next', async () => {
    cli('claude', '.local/bin/claude', '2.1.300 (Claude Code)');
    cli('codex', '.local/bin/codex', 'codex-cli 0.150.0');

    const { code, out } = await run(['status']);

    expect(code).toBe(0);
    expect(out).toMatch(/Claude Code\s+2\.1\.300\s+up to date/);
    expect(out).toMatch(/Codex\s+0\.150\.0\s+update required — Moxxy works with 0\.155\.1 or newer · moxxy agents update codex/);
    expect(out).toMatch(/OpenCode\s+—\s+not installed · moxxy agents install opencode/);
  });

  it('is what `moxxy agents` shows on its own', async () => {
    cli('opencode', '.opencode/bin/opencode', '1.19.0');

    const { out } = await run([]);

    expect(out).toMatch(/OpenCode\s+1\.19\.0\s+1\.19\.2 is out · moxxy agents update opencode/);
  });

  it('answers in JSON for scripts', async () => {
    cli('opencode', '.opencode/bin/opencode', '1.19.2');

    const { out } = await run(['status', '--json']);

    expect(JSON.parse(out)).toMatchObject({
      'claude-code': { state: 'missing', installed: null },
      'codex-agent': { state: 'missing' },
      opencode: { state: 'current', installed: '1.19.2', latest: '1.19.2', minimum: '1.19.0' },
    });
  });
});

describe('moxxy agents install / update', () => {
  it("installs with the vendor's installer, showing what it prints", async () => {
    const fake = { ...OPENCODE, install: fakeInstaller(newHome(), "console.log('Installing opencode'); console.log('Installed opencode 1.19.2');") };

    const { code, out } = await run(['install', 'opencode'], { agents: { opencode: fake } });

    expect(code).toBe(0);
    expect(out).toContain('Installing opencode');
    expect(out).toContain('OpenCode: Installed opencode 1.19.2');
  }, 30_000);

  it('updates by the command name or the connection name', async () => {
    const upgraded = path.join(newHome(), 'upgraded');
    cli('opencode', '.opencode/bin/opencode', '1.18.0', `if (args[0] === 'upgrade') { console.log('Upgraded'); require('fs').writeFileSync(${JSON.stringify(upgraded)}, ''); }`);

    const { code } = await run(['update', 'opencode']);

    expect(code).toBe(0);
    expect(existsSync(upgraded)).toBe(true);
  });

  it('fails with the reason when it does not work', async () => {
    newHome();

    const { code, err } = await run(['update', 'codex-agent']);

    expect(code).toBe(1);
    expect(err).toContain('Codex is not installed.');
  });

  it('names the agents it knows when given another', async () => {
    const { code, err } = await run(['install', 'gemini']);

    expect(code).toBe(2);
    expect(err).toContain('claude, codex, opencode');
  });
});

describe('moxxy agents --help', () => {
  it('prints the commands without checking anything', async () => {
    const { code, out } = await run(['--help'], {
      latest: async () => {
        throw new Error('checked');
      },
    });

    expect(code).toBe(0);
    expect(out).toContain('moxxy agents');
    expect(out).toContain('install <agent>');
  });
});
