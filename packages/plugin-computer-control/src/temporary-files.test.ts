import { mkdtemp, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { withTemporaryFiles } from './temporary-files.js';

it('cleans both screenshot files when conversion rejects after creating its output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moxxy-capture-test-'));
  const files = [join(dir, 'capture.png'), join(dir, 'output.jpg')];
  try {
    const failure = new Error('converter aborted');
    await expect(withTemporaryFiles(files, async () => {
      for (const file of files) await writeFile(file, 'partial image');
      throw failure;
    })).rejects.toBe(failure);
    for (const file of files) await expect(access(file)).rejects.toThrow();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
