import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeDir } from '@moxxy/vitest-preset/fs';
import { readLines } from './jsonl-lines.js';

// readLines must hand back exactly what `readFile(file, 'utf8').split('\n')`
// did, whatever the chunk size, so the session readers built on it keep their
// results byte for byte while holding only one chunk and one line in memory.

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => removeDir(dir)));
});

async function fileWith(bytes: Uint8Array): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-lines-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'log.jsonl');
  await fs.writeFile(file, bytes);
  return file;
}

async function collect(lines: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const line of lines) out.push(line);
  return out;
}

/** Small deterministic PRNG so the fuzz cases are the same on every run. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

const CASES: Record<string, Uint8Array> = {
  empty: new Uint8Array(0),
  'only newline': enc('\n'),
  'two newlines': enc('\n\n'),
  'no trailing newline': enc('{"a":1}\n{"b":2}'),
  'trailing newline': enc('{"a":1}\n{"b":2}\n'),
  crlf: enc('{"a":1}\r\n{"b":2}\r\n'),
  'lone carriage return': enc('{"a":1}\r{"b":2}\n'),
  bom: enc('﻿{"a":1}\n'),
  'polish and emoji': enc('{"t":"Zażółć gęślą jaźń 🚀🇵🇱"}\n{"t":"中文"}\n'),
  'invalid utf-8 before a newline': Uint8Array.from([0x7b, 0xe2, 0x0a, 0xf0, 0x9f, 0x0a, 0xff, 0x7d]),
  'multibyte split by every chunk size': enc('ą'.repeat(50) + '\n' + '🚀'.repeat(50)),
  'long line': enc('{"output":"' + 'x'.repeat(300_000) + '"}\n{"next":true}\n'),
};

function fuzzCase(seed: number): Uint8Array {
  const next = prng(seed);
  const bytes = new Uint8Array(2000);
  for (let i = 0; i < bytes.length; i += 1) {
    const r = next();
    bytes[i] = r < 0.08 ? 0x0a : r < 0.12 ? 0x0d : r < 0.3 ? 0x80 + Math.floor(next() * 0x80) : Math.floor(next() * 256);
  }
  return bytes;
}
for (let seed = 1; seed <= 20; seed += 1) CASES[`fuzz ${seed}`] = fuzzCase(seed);

const CHUNK_SIZES = [1, 2, 3, 5, 7, 64, 4096, undefined];

describe('readLines', () => {
  for (const [name, bytes] of Object.entries(CASES)) {
    it(`matches readFile + split for: ${name}`, async () => {
      const file = await fileWith(bytes);
      const expected = (await fs.readFile(file, 'utf8')).split('\n');
      // Byte-sized reads cover UTF-8 boundaries in the small fixtures. The
      // long-line case needs many chunks, not 300,000 individual disk reads.
      const sizes = bytes.length > 64 * 1024 ? [64, 4096, undefined] : CHUNK_SIZES;
      for (const size of sizes) {
        expect({ size, lines: await collect(readLines(file, size)) }).toEqual({ size, lines: expected });
      }
    });
  }

  it('rejects for a missing file, like readFile', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-lines-'));
    tempDirs.push(dir);
    await expect(collect(readLines(path.join(dir, 'missing.jsonl')))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects for a directory, like readFile', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-lines-'));
    tempDirs.push(dir);
    await expect(collect(readLines(dir))).rejects.toMatchObject({ code: 'EISDIR' });
  });
});
