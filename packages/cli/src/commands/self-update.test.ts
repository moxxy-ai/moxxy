import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beginTransaction } from '@moxxy/plugin-self-update';
import { removeDir } from '@moxxy/vitest-preset/fs';
import { runSelfUpdateCommand } from './self-update.js';

let home: string;
let out: string[];

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-self-update-'));
  vi.stubEnv('MOXXY_HOME', home);
  out = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await removeDir(home);
});

describe('moxxy self-update status', () => {
  it('lists the transactions kept in MOXXY_HOME', async () => {
    const { txnId } = await beginTransaction({ moxxyDir: home, kind: 'plugin', name: 'greeter' });
    expect(await runSelfUpdateCommand({ command: 'self-update', positional: ['status'], flags: {} } as never)).toBe(0);
    expect(out.join('')).toContain(txnId);
  });
});
