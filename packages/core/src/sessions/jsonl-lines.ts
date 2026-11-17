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
