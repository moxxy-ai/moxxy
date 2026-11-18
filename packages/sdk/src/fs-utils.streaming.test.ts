import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, expectTypeOf, it } from 'vitest';
import { removeDir } from '@moxxy/vitest-preset/fs';
import { writeFileAtomic } from './fs-utils.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => removeDir(dir)));
});

async function targetFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'moxxy-atomic-chunks-'));
  dirs.push(dir);
  return join(dir, 'session.jsonl');
}

it('accepts iterable chunks in the public atomic-write contract', () => {
  expectTypeOf<Iterable<string | Uint8Array>>().toExtend<Parameters<typeof writeFileAtomic>[1]>();
});

it('keeps the old file visible until every chunk has been written', async () => {
  const target = await targetFile();
  await writeFile(target, 'old');
  async function* chunks() {
    yield 'Zażółć\n';
    expect(await readFile(target, 'utf8')).toBe('old');
    yield Buffer.from('🚀\n');
  }
  await writeFileAtomic(target, chunks(), { mode: 0o600 });
  expect(await readFile(target, 'utf8')).toBe('Zażółć\n🚀\n');
});

it('preserves the original and removes the temp file when producing chunks fails', async () => {
  const target = await targetFile();
  await writeFile(target, 'original');
  function* chunks() {
    yield 'partial replacement\n';
    throw new Error('interrupted serialization');
  }
  await expect(writeFileAtomic(target, chunks())).rejects.toThrow('interrupted serialization');
  expect(await readFile(target, 'utf8')).toBe('original');
  expect(await readdir(join(target, '..'))).toEqual(['session.jsonl']);
});
