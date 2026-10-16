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
import { codexAgentProviderDef } from './index.js';
import { codexTarget } from './executable.js';

const saved = { HOME: process.env.HOME, PATH: process.env.PATH, MOXXY_HOME: process.env.MOXXY_HOME, CODEX_EXECUTABLE: process.env.CODEX_EXECUTABLE };
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
  home = mkdtempSync(path.join(tmpdir(), 'moxxy-codex-cli-'));
  const file = path.join(home, '.local/bin', 'codex');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `#!/bin/sh\n${script}\nprintf '%s\\n' ${JSON.stringify(printed)}\n`);
  chmodSync(file, 0o755);
  process.env.HOME = home;
  process.env.PATH = '';
  delete process.env.CODEX_EXECUTABLE;
  return file;
}

describe.skipIf(process.platform === 'win32')('the codex CLI', () => {
  it("is found where the vendor's installer put it, off PATH", () => {
    const file = installed('codex-cli 0.150.0');

    expect(JSON.stringify(codexTarget('codex'))).toContain(JSON.stringify(file).slice(1, -1));
  });

  it('is checked for updates against the version the registry last gave', async () => {
    installed('codex-cli 0.150.0');
    const moxxyHome = path.join(home ?? '', 'moxxy');
    mkdirSync(path.join(moxxyHome, 'cache'), { recursive: true });
    writeFileSync(
      path.join(moxxyHome, 'cache', 'agent-cli-latest.json'),
      JSON.stringify({ '@openai/codex': { version: '0.162.1', at: Date.now() } }),
    );
    process.env.MOXXY_HOME = moxxyHome;
    const cli = codexAgentProviderDef.agentCli;
    assertDefined(cli, 'the provider checks its CLI');

    const report = await cli.check();

    expect(report).toMatchObject({ installed: '0.150.0', latest: '0.162.1' });
    expect(['update-required', 'update-available']).toContain(report.state);
  });

  it('says who the agent is signed in as', async () => {
    installed('codex-cli 0.162.1', 'if [ "$1" = "login" ]; then echo "Logged in using ChatGPT"; exit 0; fi');
    const moxxyHome = path.join(home ?? '', 'moxxy');
    mkdirSync(path.join(moxxyHome, 'cache'), { recursive: true });
    writeFileSync(path.join(moxxyHome, 'cache', 'agent-cli-latest.json'), JSON.stringify({ '@openai/codex': { version: '0.162.1', at: Date.now() } }));
    process.env.MOXXY_HOME = moxxyHome;
    const cli = codexAgentProviderDef.agentCli;
    assertDefined(cli, 'the provider checks its CLI');

    expect(await cli.check()).toMatchObject({ signedIn: true, account: 'ChatGPT' });
  });
});
