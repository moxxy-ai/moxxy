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
import { opencodeProviderDef } from './index.js';
import { opencodeTarget } from './executable.js';

const saved = { HOME: process.env.HOME, PATH: process.env.PATH, MOXXY_HOME: process.env.MOXXY_HOME, OPENCODE_EXECUTABLE: process.env.OPENCODE_EXECUTABLE };
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
  home = mkdtempSync(path.join(tmpdir(), 'moxxy-opencode-cli-'));
  const file = path.join(home, '.opencode/bin', 'opencode');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `#!/bin/sh\n${script}\nprintf '%s\\n' ${JSON.stringify(printed)}\n`);
  chmodSync(file, 0o755);
  process.env.HOME = home;
  process.env.PATH = '';
  delete process.env.OPENCODE_EXECUTABLE;
  return file;
}

describe.skipIf(process.platform === 'win32')('the opencode CLI', () => {
  it("is found where the vendor's installer put it, off PATH", () => {
    const file = installed('1.18.2');

    expect(JSON.stringify(opencodeTarget('opencode'))).toContain(JSON.stringify(file).slice(1, -1));
  });

  it('is checked for updates against the version the registry last gave', async () => {
    installed('1.18.2');
    const moxxyHome = path.join(home ?? '', 'moxxy');
    mkdirSync(path.join(moxxyHome, 'cache'), { recursive: true });
    writeFileSync(
      path.join(moxxyHome, 'cache', 'agent-cli-latest.json'),
      JSON.stringify({ 'opencode-ai': { version: '1.19.0', at: Date.now() } }),
    );
    process.env.MOXXY_HOME = moxxyHome;
    const cli = opencodeProviderDef.agentCli;
    assertDefined(cli, 'the provider checks its CLI');

    const report = await cli.check();

    expect(report).toMatchObject({ installed: '1.18.2', latest: '1.19.0' });
    expect(['update-required', 'update-available']).toContain(report.state);
  });

  it('says who the agent is signed in as', async () => {
    installed('1.19.2', 'if [ "$1" = "auth" ]; then echo "● OpenCode Zen api"; exit 0; fi');
    const moxxyHome = path.join(home ?? '', 'moxxy');
    mkdirSync(path.join(moxxyHome, 'cache'), { recursive: true });
    writeFileSync(path.join(moxxyHome, 'cache', 'agent-cli-latest.json'), JSON.stringify({ 'opencode-ai': { version: '1.19.2', at: Date.now() } }));
    process.env.MOXXY_HOME = moxxyHome;
    const cli = opencodeProviderDef.agentCli;
    assertDefined(cli, 'the provider checks its CLI');

    expect(await cli.check()).toMatchObject({ signedIn: true, account: 'OpenCode Zen' });
  });
});
