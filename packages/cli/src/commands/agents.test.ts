/**
 * `moxxy agents`: where the Claude, Codex and OpenCode CLIs stand, and
 * installing or updating one. The CLIs are real executables in a temporary
 * home; only the npm registry is stood in for.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeDirSync } from '@moxxy/vitest-preset/fs';
import { OPENCODE_CLI } from '@moxxy/agent-connection-kit';
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

function cli(relative: string, version: string, script = ''): string {
  const file = path.join(home ?? newHome(), relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `#!/bin/sh\nif [ "$1" = "--version" ]; then printf '%s\\n' ${JSON.stringify(version)}; exit 0; fi\n${script}\n`);
  chmodSync(file, 0o755);
  return file;
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
    cli('.local/bin/claude', '2.1.300 (Claude Code)');
    cli('.local/bin/codex', 'codex-cli 0.150.0');

    const { code, out } = await run(['status']);

    expect(code).toBe(0);
    expect(out).toMatch(/Claude Code\s+2\.1\.300\s+up to date/);
    expect(out).toMatch(/Codex\s+0\.150\.0\s+update required — Moxxy works with 0\.155\.1 or newer · moxxy agents update codex/);
    expect(out).toMatch(/OpenCode\s+—\s+not installed · moxxy agents install opencode/);
  });

  it('is what `moxxy agents` shows on its own', async () => {
    cli('.opencode/bin/opencode', '1.19.0');

    const { out } = await run([]);

    expect(out).toMatch(/OpenCode\s+1\.19\.0\s+1\.19\.2 is out · moxxy agents update opencode/);
  });

  it('answers in JSON for scripts', async () => {
    cli('.opencode/bin/opencode', '1.19.2');

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
    newHome();
    const fake = { ...OPENCODE_CLI, install: { posix: "echo 'Installing opencode'; echo 'Installed opencode 1.19.2'", windows: '' } };

    const { code, out } = await run(['install', 'opencode'], { agents: { opencode: fake } });

    expect(code).toBe(0);
    expect(out).toContain('Installing opencode');
    expect(out).toContain('OpenCode: Installed opencode 1.19.2');
  });

  it('updates by the command name or the connection name', async () => {
    const file = cli('.opencode/bin/opencode', '1.18.0', 'if [ "$1" = "upgrade" ]; then echo "Upgraded"; touch "$0.upgraded"; fi');

    const { code } = await run(['update', 'opencode']);

    expect(code).toBe(0);
    expect(existsSync(`${file}.upgraded`)).toBe(true);
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
