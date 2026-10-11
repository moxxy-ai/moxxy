/**
 * The Claude Agent SDK lives outside Moxxy's bundle, in a folder under
 * `~/.moxxy`, installed with the person's npm when the connection is chosen.
 * npm is the external boundary here: a stand-in `npm` on PATH lays the
 * package out the way npm would.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeDirSync } from '@moxxy/vitest-preset/fs';
import { CLAUDE_AGENT_SDK_PACKAGE, ensureClaudeAgentSdk, installClaudeAgentSdk, loadClaudeAgentSdk } from './sdk-install.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) removeDirSync(root);
});

function tempRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'moxxy-claude-sdk-'));
  roots.push(root);
  return root;
}

/** Lay out the SDK package in `dir` the way npm leaves it. */
function writeSdk(dir: string, marker: string): void {
  const pkg = path.join(dir, 'node_modules', ...CLAUDE_AGENT_SDK_PACKAGE.split('/'));
  mkdirSync(pkg, { recursive: true });
  writeFileSync(
    path.join(pkg, 'package.json'),
    JSON.stringify({ name: CLAUDE_AGENT_SDK_PACKAGE, type: 'module', exports: { '.': { default: './sdk.mjs' } } }),
  );
  writeFileSync(path.join(pkg, 'sdk.mjs'), `export const marker = ${JSON.stringify(marker)};\nexport function query() { return marker; }\n`);
}

describe('loading the Claude Agent SDK', () => {
  it('loads the SDK installed in its folder', async () => {
    const dir = tempRoot();
    writeSdk(dir, 'loaded');

    const sdk = await loadClaudeAgentSdk(dir);

    expect((sdk.query as unknown as () => string)()).toBe('loaded');
  });

  it('says what is wrong when the folder holds no SDK', async () => {
    await expect(loadClaudeAgentSdk(tempRoot())).rejects.toThrow(/Claude Agent SDK/);
  });
});

describe.skipIf(process.platform === 'win32')('installing the Claude Agent SDK with npm', () => {
  /** A stand-in npm: records its arguments, then installs or fails. */
  function fakeNpm(root: string, behaviour: 'install' | 'fail'): string {
    const bin = path.join(root, 'bin');
    mkdirSync(bin, { recursive: true });
    const script = path.join(bin, 'npm');
    writeFileSync(
      script,
      `#!/usr/bin/env node
const fs = require('node:fs'); const path = require('node:path');
fs.appendFileSync(${JSON.stringify(path.join(root, 'npm-calls.log'))}, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }) + '\\n');
if (${JSON.stringify(behaviour)} === 'fail') { process.stderr.write('npm ERR! network unreachable\\n'); process.exit(1); }
const pkg = path.join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk');
fs.mkdirSync(pkg, { recursive: true });
fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@anthropic-ai/claude-agent-sdk', type: 'module', main: 'sdk.mjs' }));
fs.writeFileSync(path.join(pkg, 'sdk.mjs'), 'export function query() { return "installed"; }\\n');
`,
    );
    chmodSync(script, 0o755);
    return bin;
  }

  const calls = (root: string) =>
    readFileSync(path.join(root, 'npm-calls.log'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { cwd: string; args: string[] });

  it('installs the pinned version without the bundled CLI, then loads it', async () => {
    const root = tempRoot();
    const pathEnv = fakeNpm(root, 'install');
    const home = path.join(root, 'agents', 'claude-agent-sdk');

    const sdk = await ensureClaudeAgentSdk({ home, version: '0.3.296', pathEnv });

    expect((sdk.query as unknown as () => string)()).toBe('installed');
    const [call] = calls(root);
    expect(call?.args).toEqual(expect.arrayContaining(['install', '--omit=optional']));
    const manifest = JSON.parse(readFileSync(path.join(home, '0.3.296', 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(manifest.dependencies).toEqual({ [CLAUDE_AGENT_SDK_PACKAGE]: '0.3.296' });
  });

  it('does not install again once the version is there', async () => {
    const root = tempRoot();
    const pathEnv = fakeNpm(root, 'install');
    const home = path.join(root, 'agents', 'claude-agent-sdk');

    await installClaudeAgentSdk({ home, version: '0.3.296', pathEnv });
    await ensureClaudeAgentSdk({ home, version: '0.3.296', pathEnv });

    expect(calls(root)).toHaveLength(1);
  });

  it('leaves no half-installed folder behind when npm fails, and says why', async () => {
    const root = tempRoot();
    const pathEnv = fakeNpm(root, 'fail');
    const home = path.join(root, 'agents', 'claude-agent-sdk');

    await expect(installClaudeAgentSdk({ home, version: '0.3.296', pathEnv })).rejects.toThrow(/network unreachable/);

    expect(existsSync(path.join(home, '0.3.296'))).toBe(false);
    expect(existsSync(home) ? readdirSync(home) : []).toEqual([]);
  });

  it('says npm is needed when there is none', async () => {
    const root = tempRoot();

    await expect(
      installClaudeAgentSdk({ home: path.join(root, 'sdk'), version: '0.3.296', pathEnv: path.join(root, 'empty') }),
    ).rejects.toThrow(/npm/);
  });
});
