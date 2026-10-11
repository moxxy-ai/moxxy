/**
 * Which version of a vendor agent CLI the person has, who installed it, and
 * the command that updates it the same way. The CLIs here are real
 * executables in a temporary folder, laid out the way each installer leaves them.
 */
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeDirSync } from '@moxxy/vitest-preset/fs';
import {
  compareVersions,
  detectInstaller,
  inspectAgentCli,
  parseVersion,
  updateCommandFor,
  type AgentCliSpec,
} from './cli-version.js';

const claude: AgentCliSpec = {
  command: 'claude',
  nativeDirs: ['.local/share/claude'],
  update: {
    npm: ['install', '-g', '@anthropic-ai/claude-code@latest'],
    brew: ['upgrade', '--cask', 'claude-code'],
    native: ['update'],
  },
};

describe('reading a version', () => {
  it('finds the version in what each CLI prints', () => {
    expect(parseVersion('2.1.296 (Claude Code)\n')).toBe('2.1.296');
    expect(parseVersion('codex-cli 0.155.1')).toBe('0.155.1');
    expect(parseVersion('1.18.35')).toBe('1.18.35');
    expect(parseVersion('2.0.0-beta.3')).toBe('2.0.0-beta.3');
    expect(parseVersion('no version here')).toBeNull();
  });

  it('orders versions by their numbers, a pre-release before its release', () => {
    expect(compareVersions('2.1.296', '2.1.30')).toBeGreaterThan(0);
    expect(compareVersions('0.155.1', '0.161.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('2.0.0-beta.3', '2.0.0')).toBeLessThan(0);
  });
});

describe('who installed the CLI', () => {
  it('tells npm, Homebrew and the vendor installer apart by where the CLI lives', () => {
    expect(detectInstaller('/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js', claude)).toBe('npm');
    expect(detectInstaller('C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js', claude)).toBe('npm');
    expect(detectInstaller('/opt/homebrew/Caskroom/claude-code/2.1.296/claude', claude)).toBe('brew');
    expect(detectInstaller('/opt/homebrew/Cellar/opencode/1.18.35/bin/opencode', claude)).toBe('brew');
    expect(detectInstaller('/home/a/.linuxbrew/bin/codex', claude)).toBe('brew');
    expect(detectInstaller('/Users/a/.local/share/claude/versions/2.1.296', claude)).toBe('native');
    expect(detectInstaller('/usr/bin/claude', claude)).toBe('unknown');
  });

  it('updates the CLI the way it was installed, and offers nothing it cannot be sure of', () => {
    expect(updateCommandFor('npm', claude, '/x/claude')).toEqual({ command: 'npm', args: ['install', '-g', '@anthropic-ai/claude-code@latest'] });
    expect(updateCommandFor('brew', claude, '/x/claude')).toEqual({ command: 'brew', args: ['upgrade', '--cask', 'claude-code'] });
    expect(updateCommandFor('native', claude, '/x/claude')).toEqual({ command: '/x/claude', args: ['update'] });
    expect(updateCommandFor('unknown', claude, '/x/claude')).toBeNull();
    expect(updateCommandFor('brew', { command: 'codex', update: { npm: ['install', '-g', '@openai/codex'] } }, '/x/codex')).toBeNull();
  });
});

describe.skipIf(process.platform === 'win32')('looking at the installed CLI', () => {
  let root: string | undefined;
  afterEach(() => {
    if (root) removeDirSync(root);
    root = undefined;
  });

  function cli(relative: string, prints: string): string {
    root ??= mkdtempSync(path.join(tmpdir(), 'moxxy-cli-'));
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(prints)});\n`);
    chmodSync(file, 0o755);
    return file;
  }

  it('reads the version of an npm install through the link on PATH', async () => {
    const entry = cli('lib/node_modules/@anthropic-ai/claude-code/cli.js', '2.1.296 (Claude Code)\n');
    const bin = path.join(path.dirname(path.dirname(path.dirname(path.dirname(entry)))), 'bin');
    mkdirSync(bin);
    symlinkSync(entry, path.join(bin, 'claude'));

    const info = await inspectAgentCli(claude, { pathEnv: bin });

    expect(info).toEqual({
      path: path.join(bin, 'claude'),
      version: '2.1.296',
      installer: 'npm',
      update: { command: 'npm', args: ['install', '-g', '@anthropic-ai/claude-code@latest'] },
    });
  });

  it('says the CLI is missing when it is not on PATH', async () => {
    root = mkdtempSync(path.join(tmpdir(), 'moxxy-cli-'));
    expect(await inspectAgentCli(claude, { pathEnv: root })).toBeNull();
  });

  it('keeps going without a version when the CLI prints none', async () => {
    const file = cli('bin/claude', 'hello\n');

    const info = await inspectAgentCli(claude, { pathEnv: path.dirname(file) });

    expect(info).toMatchObject({ version: null, installer: 'unknown', update: null });
  });
});
