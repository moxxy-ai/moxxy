import { open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';

const NEWLINE = 0x0a;
const DEFAULT_CHUNK_BYTES = 1024 * 1024;

/**
 * The lines of a file, exactly as `readFile(file, 'utf8').split('\n')` gives
 * them, while holding one chunk and one line in memory instead of the whole
 * file. A session log can outgrow the longest string Node can build (~512 MiB),
 * and whole-file reads of many logs at once ran the runner out of memory.
 *
 * Splitting on the `\n` byte before decoding is safe: in UTF-8 that byte never
 * occurs inside a multi-byte character. Read errors (missing file, a directory)
 * reject the iteration, as `readFile` rejects.
 */
export async function* readLines(file: string, chunkBytes = DEFAULT_CHUNK_BYTES): AsyncGenerator<string> {
  const stream = createReadStream(file, { highWaterMark: chunkBytes });
  let pending: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    let start = 0;
    for (let end = chunk.indexOf(NEWLINE); end !== -1; end = chunk.indexOf(NEWLINE, start)) {
      pending.push(chunk.subarray(start, end));
      yield Buffer.concat(pending).toString('utf8');
      pending = [];
      start = end + 1;
    }
    if (start < chunk.length) pending.push(chunk.subarray(start));
  }
  yield Buffer.concat(pending).toString('utf8');
}

/** Read one snapshot from its tail. Split on LF bytes before decoding so a block can end inside UTF-8. */
export async function* readLinesBackwards(file: string, chunkBytes = 64 * 1024): AsyncGenerator<string> {
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) throw new RangeError('Invalid block size');
  const handle = await open(file, 'r');
  try {
    let end = (await handle.stat()).size;
    let fragments: Buffer[] = [];
    while (end > 0) {
      const start = Math.max(0, end - chunkBytes);
      const bytes = Buffer.allocUnsafe(end - start);
      let filled = 0;
      while (filled < bytes.length) {
        const { bytesRead } = await handle.read(bytes, filled, bytes.length - filled, start + filled);
        if (!bytesRead) throw new Error('History truncated during read');
        filled += bytesRead;
      }
      let right = bytes.length;
      while (right > 0) {
        const newline = bytes.lastIndexOf(NEWLINE, right - 1);
        if (newline < 0) break;
        const tail = bytes.subarray(newline + 1, right);
        fragments.push(tail);
        yield fragments.length === 1 ? tail.toString('utf8') : Buffer.concat(fragments.reverse()).toString('utf8');
        fragments = [];
        right = newline;
      }
      if (right) fragments.push(bytes.subarray(0, right));
      end = start;
    }
    yield Buffer.concat(fragments.reverse()).toString('utf8');
  } finally {
    await handle.close();
  }
}
