import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { TerminalProcessImpl } from './pty.js';

const MAX_SCROLLBACK = 200_000;

/** A minimal stand-in for the piped child the impl wires its stdout listeners
 *  onto, so we can feed `emitData` without spawning a real shell. */
function fakeChild(): {
  stdout: EventEmitter;
  stderr: EventEmitter;
  proc: EventEmitter & { stdin: { write(): void; end(): void } };
} {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write(): void; end(): void };
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: () => {}, end: () => {} };
  return { stdout: proc.stdout, stderr: proc.stderr, proc };
}

describe('TerminalProcessImpl scrollback (hysteresis trim)', () => {
  it('keeps scrollback bounded to the cap and returns the true tail', () => {
    const { stdout, proc } = fakeChild();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const term = new TerminalProcessImpl('pipe', null, proc as any);

    // Emit far more than the cap in many small chunks (the saturated path that
    // used to copy the whole cap on every chunk).
    let written = '';
    const chunk = 'x'.repeat(1000);
    for (let i = 0; i < 500; i += 1) {
      // Mark each chunk's last char so we can verify the exact tail.
      const tagged = chunk.slice(0, -6) + i.toString().padStart(6, '0');
      written += tagged;
      stdout.emit('data', Buffer.from(tagged, 'utf8'));
    }

    const sb = term.scrollback();
    // Observable tail is exactly the last MAX_SCROLLBACK chars of all output —
    // byte-identical to the old `(buffer + d).slice(-MAX_SCROLLBACK)` semantics.
    expect(sb.length).toBe(MAX_SCROLLBACK);
    expect(sb).toBe(written.slice(-MAX_SCROLLBACK));
  });

  it('returns the whole buffer untouched while under the cap', () => {
    const { stdout, proc } = fakeChild();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const term = new TerminalProcessImpl('pipe', null, proc as any);
    stdout.emit('data', Buffer.from('hello ', 'utf8'));
    stdout.emit('data', Buffer.from('world', 'utf8'));
    expect(term.scrollback()).toBe('hello world');
  });
});
