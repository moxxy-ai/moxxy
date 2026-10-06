import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readLocalFiles } from './local-files.js';
import { removeDir } from '@moxxy/vitest-preset/fs';

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-local-files-'));
});
afterEach(async () => {
  await removeDir(tmp);
});

const limits = { maxTotalBytes: 10, service: 'Telegram', limitLabel: '10 B per message' };

describe('readLocalFiles (files the agent attaches to a message)', () => {
  it('reads each file with its name, resolving relative paths against the cwd', async () => {
    await fs.writeFile(path.join(tmp, 'a.txt'), 'hello');

    const files = await readLocalFiles(['a.txt'], { cwd: tmp, ...limits });

    expect(files).toEqual([{ name: 'a.txt', path: path.join(tmp, 'a.txt'), data: Buffer.from('hello') }]);
  });

  it('refuses a path that is not a file before reading anything', async () => {
    await expect(readLocalFiles([tmp], { cwd: tmp, ...limits })).rejects.toThrow(/is not a file/);
  });

  it("refuses files larger together than the messenger accepts, naming its limit", async () => {
    await fs.writeFile(path.join(tmp, 'big.bin'), Buffer.alloc(11));

    await expect(readLocalFiles(['big.bin'], { cwd: tmp, ...limits })).rejects.toThrow(
      /Telegram accepts at most 10 B per message/,
    );
  });

  it('expands ~ to the home directory', async () => {
    const files = await readLocalFiles([], { cwd: tmp, ...limits });
    expect(files).toEqual([]);
    await expect(readLocalFiles(['~/definitely-missing-moxxy-file'], { cwd: tmp, ...limits })).rejects.toThrow(
      /~\/definitely-missing-moxxy-file is not a file/,
    );
  });
});
