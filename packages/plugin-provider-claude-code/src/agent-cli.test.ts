/**
 * The connection's CLI: found where the vendor's installer puts it even when
 * this process's PATH does not reach there, and checked for updates. The CLI
 * is a real executable in a temporary home; the registry's answer is a fresh
 * entry in Moxxy's cache, so nothing goes to the network.
 */
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertDefined } from '@moxxy/sdk';
import { removeDirSync } from '@moxxy/vitest-preset/fs';
import { claudeCodeProviderDef } from './index.js';
import { resolveClaudeForSdk } from './executable.js';
import { checkClaudeCliAuth } from './login.js';

const saved = { HOME: process.env.HOME, PATH: process.env.PATH, MOXXY_HOME: process.env.MOXXY_HOME, CLAUDE_CODE_EXECUTABLE: process.env.CLAUDE_CODE_EXECUTABLE };
let home: string | undefined;

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (home) removeDirSync(home);
  home = undefined;
});

function installed(printed: string, script = ''): string {
  home = mkdtempSync(path.join(tmpdir(), 'moxxy-claude-cli-'));
  const file = path.join(home, '.local/bin', 'claude');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `#!/bin/sh\n${script}\nprintf '%s\\n' ${JSON.stringify(printed)}\n`);
  chmodSync(file, 0o755);
  process.env.HOME = home;
  process.env.PATH = '';
  delete process.env.CLAUDE_CODE_EXECUTABLE;
  return file;
}

describe.skipIf(process.platform === 'win32')('the claude CLI', () => {
  it("is found where the vendor's installer put it, off PATH", () => {
    const file = installed('2.1.250 (Claude Code)');

    expect(JSON.stringify(resolveClaudeForSdk('claude'))).toContain(JSON.stringify(file).slice(1, -1));
  });

  it('reports its sign-in from there too', async () => {
    installed('{"loggedIn":true}');

    expect(await checkClaudeCliAuth('claude')).toMatchObject({ state: 'signed-in' });
  });

  it('is checked for updates against the version the registry last gave', async () => {
    installed('2.1.250 (Claude Code)');
    const moxxyHome = path.join(home ?? '', 'moxxy');
    mkdirSync(path.join(moxxyHome, 'cache'), { recursive: true });
    writeFileSync(
      path.join(moxxyHome, 'cache', 'agent-cli-latest.json'),
      JSON.stringify({ '@anthropic-ai/claude-code': { version: '2.1.300', at: Date.now() } }),
    );
    process.env.MOXXY_HOME = moxxyHome;
    const cli = claudeCodeProviderDef.agentCli;
    assertDefined(cli, 'the provider checks its CLI');

    const report = await cli.check();

    expect(report).toMatchObject({ installed: '2.1.250', latest: '2.1.300' });
    expect(['update-required', 'update-available']).toContain(report.state);
  });

  it('says who the agent is signed in as', async () => {
    installed('2.1.300 (Claude Code)', 'if [ "$1" = "auth" ]; then echo \'{"loggedIn":true,"email":"ada@example.com"}\'; exit 0; fi');
    const moxxyHome = path.join(home ?? '', 'moxxy');
    mkdirSync(path.join(moxxyHome, 'cache'), { recursive: true });
    writeFileSync(path.join(moxxyHome, 'cache', 'agent-cli-latest.json'), JSON.stringify({ '@anthropic-ai/claude-code': { version: '2.1.300', at: Date.now() } }));
    process.env.MOXXY_HOME = moxxyHome;
    const cli = claudeCodeProviderDef.agentCli;
    assertDefined(cli, 'the provider checks its CLI');

    expect(await cli.check()).toMatchObject({ signedIn: true, account: 'ada@example.com' });
  });
});
