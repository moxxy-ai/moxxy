import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { spawnShell, withPathFirst } from './shell.js';
import { removeDirSync } from '@moxxy/vitest-preset/fs';

function output(command: string, env: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnShell(command, { cwd: tmpdir(), env });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
    child.on('error', reject);
    child.on('close', () => resolve(out));
  });
}

describe('withPathFirst', () => {
  it('leaves a command alone when the host names no folders', () => {
    expect(withPathFirst('echo hi', undefined)).toBe('echo hi');
    expect(withPathFirst('echo hi', '')).toBe('echo hi');
  });

  it('puts the folders back in front, quoted so a path with spaces or a quote stays one word', () => {
    expect(withPathFirst('echo hi', "/Users/it's me/py/bin:/opt/x")).toBe(`export PATH='/Users/it'\\''s me/py/bin:/opt/x':"$PATH"\necho hi`);
  });
});

// The Bash tool is POSIX-only (it spawns /bin/sh); Windows runs the terminal plugin instead.
describe.skipIf(process.platform === 'win32')('spawnShell', () => {
  it('keeps the folders the host put first ahead of the system ones, which a login shell moves to the front', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'moxxy path first-'));
    try {
      const shown = await output('printf %s "$PATH"', { MOXXY_PATH_FIRST: dir, PATH: `${dir}:/usr/bin:/bin` });
      expect(shown.split(':')[0]).toBe(dir);
    } finally {
      removeDirSync(dir);
    }
  });

  it('runs the command unchanged when the host names no folders', async () => {
    expect(await output('printf %s "$0"', { MOXXY_PATH_FIRST: '' })).toBe('/bin/sh');
  });
});
