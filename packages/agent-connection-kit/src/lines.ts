import { StringDecoder } from 'node:string_decoder';
import type { Readable } from 'node:stream';

/**
 * Calls `onLine` with each line of a stream that holds one JSON message per
 * line, then `onEnd` once the stream is done.
 *
 * A line ends only at "\n" (a "\r" before it is JSON whitespace, so a line
 * ending "\r\n" still parses). `node:readline` also ends lines at U+2028 and
 * U+2029, which JSON allows raw inside a string and Codex sends that way, so
 * it cut such a message in two and the message was lost.
 */
export function readLines(readable: Readable, onLine: (line: string) => void, onEnd: () => void = () => {}): void {
  const decoder = new StringDecoder('utf8');
  // The pieces of the line still waiting for its "\n": a message of many megabytes arrives in many pieces.
  let partial: string[] = [];
  let ended = false;
  const take = (text: string) => {
    let start = 0;
    for (let newline = text.indexOf('\n'); newline !== -1; newline = text.indexOf('\n', start)) {
      partial.push(text.slice(start, newline));
      const line = partial.join('');
      partial = [];
      onLine(line);
      start = newline + 1;
    }
    if (start < text.length) partial.push(text.slice(start));
  };
  const end = () => {
    if (ended) return;
    ended = true;
    take(decoder.end());
    // The agent may exit right after its last message, before ending the line.
    if (partial.length > 0) onLine(partial.join(''));
    partial = [];
    onEnd();
  };
  readable.on('data', (chunk: Buffer | string) => take(typeof chunk === 'string' ? chunk : decoder.write(chunk)));
  readable.on('end', end);
  readable.on('close', end);
}
