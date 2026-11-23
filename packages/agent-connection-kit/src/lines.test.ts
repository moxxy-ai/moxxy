/**
 * Cutting an agent's output into its one-message lines. The stream is the
 * boundary: what arrives is written into it in the pieces a pipe delivers.
 */
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { readLines } from './lines.js';

const LS = String.fromCharCode(0x2028);

function reader() {
  const stream = new PassThrough();
  const lines: string[] = [];
  let ends = 0;
  readLines(stream, (line) => lines.push(line), () => (ends += 1));
  return { stream, lines, ends: () => ends };
}

describe('reading an agent stream line by line', () => {
  it('gives a message of many megabytes, delivered in pipe-sized pieces, as one line', () => {
    // As Codex resumes a long thread: its whole history in one answer, a separator somewhere inside.
    const message = JSON.stringify({ id: 4, result: { text: `${'x'.repeat(6_000_000)}${LS}${'ż'.repeat(3_000_000)}` } });
    const bytes = Buffer.from(`${message}\n{"id":5}\n`);
    const { stream, lines } = reader();

    for (let at = 0; at < bytes.length; at += 65_536) stream.write(bytes.subarray(at, at + 65_536));

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(message);
    expect(lines[1]).toBe('{"id":5}');
  });

  it('ends once when the stream is torn down without ending, keeping what was still unread', () => {
    const { stream, lines, ends } = reader();

    stream.write('{"id":1}\n{"id":2}');
    stream.destroy();

    return new Promise<void>((resolve) =>
      stream.once('close', () => {
        expect(lines).toEqual(['{"id":1}', '{"id":2}']);
        expect(ends()).toBe(1);
        resolve();
      }),
    );
  });
});
