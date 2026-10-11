import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeDir } from '@moxxy/vitest-preset/fs';
import { runPermsCommand } from './perms.js';

let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-perms-'));
  vi.stubEnv('MOXXY_HOME', home);
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await removeDir(home);
});

describe('moxxy perms', () => {
  it('writes the rule to permissions.json in MOXXY_HOME', async () => {
    const code = await runPermsCommand({ command: 'perms', positional: ['deny', 'Bash', 'no', 'shell'], flags: {} } as never);
    expect(code).toBe(0);
    const policy = JSON.parse(await fs.readFile(path.join(home, 'permissions.json'), 'utf8')) as { deny: unknown[] };
    expect(policy.deny).toEqual([{ name: 'Bash', reason: 'no shell' }]);
  });
});
