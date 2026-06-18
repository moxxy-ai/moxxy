import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { VaultStore } from '@moxxy/plugin-vault';
import { buildProviderAuthContext } from './auth-context.js';

function fakeVault(): VaultStore {
  return {
    get: async () => undefined,
    set: async () => {},
    delete: async () => {},
  } as unknown as VaultStore;
}

describe('buildProviderAuthContext stdin prompt (u30-2)', () => {
  it('reads one stdin line per prompt', async () => {
    const stdin = new PassThrough();
    const ctx = buildProviderAuthContext(fakeVault(), {
      headless: true,
      promptMode: 'stdin',
      write: () => {},
      stdin,
    });
    expect(ctx.prompt).toBeTypeOf('function');

    const a = ctx.prompt!('first?');
    const b = ctx.prompt!('second?');
    stdin.write('alpha\n');
    stdin.write('bravo\n');
    expect(await a).toBe('alpha');
    expect(await b).toBe('bravo');
  });

  it('a second login in the same process reads fresh lines (no stale stdinEnded trap)', async () => {
    // First login: its stdin closes (e.g. host ended the pipe), which in the
    // old module-global design flipped `stdinEnded` permanently true.
    const stdin1 = new PassThrough();
    const ctx1 = buildProviderAuthContext(fakeVault(), {
      headless: true,
      promptMode: 'stdin',
      write: () => {},
      stdin: stdin1,
    });
    const p1 = ctx1.prompt!('token?');
    stdin1.end(); // close stdin -> resolves pending read as '' (cancellation)
    expect(await p1).toBe('');

    // Second login in the SAME process: must start fresh and read real input,
    // not inherit the previous reader's permanently-ended state.
    const stdin2 = new PassThrough();
    const ctx2 = buildProviderAuthContext(fakeVault(), {
      headless: true,
      promptMode: 'stdin',
      write: () => {},
      stdin: stdin2,
    });
    const p2 = ctx2.prompt!('token again?');
    stdin2.write('charlie\n');
    expect(await p2).toBe('charlie');
  });

  it('a line that arrives before the prompt is queued, not dropped', async () => {
    const stdin = new PassThrough();
    const ctx = buildProviderAuthContext(fakeVault(), {
      headless: true,
      promptMode: 'stdin',
      write: () => {},
      stdin,
    });
    // First read consumes the line; write a second line before asking again.
    const first = ctx.prompt!('q1?');
    stdin.write('one\n');
    expect(await first).toBe('one');
    stdin.write('two\n');
    // Give the 'line' event a tick to land in the queue.
    await new Promise((r) => setImmediate(r));
    expect(await ctx.prompt!('q2?')).toBe('two');
  });
});
