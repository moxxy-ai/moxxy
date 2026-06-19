import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { asSessionId, asToolCallId, asTurnId } from '@moxxy/sdk';
import type { ToolContext } from '@moxxy/sdk';
import { grepTool } from './grep.js';

let tmp: string;

const baseCtx = (): ToolContext => ({
  sessionId: asSessionId('s'),
  turnId: asTurnId('t'),
  callId: asToolCallId('c'),
  cwd: tmp,
  signal: new AbortController().signal,
  log: { length: 0, at: () => undefined, slice: () => [], ofType: () => [], byTurn: () => [], toJSON: () => [] },
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
});

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-grep-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('grepTool size cap + binary skip', () => {
  it('skips an oversized file but still matches a normal text file', async () => {
    // A >10MB file containing the pattern — must be skipped (working-set cap).
    const big = 'NEEDLE\n'.repeat(2_000_000); // ~14MB
    await fs.writeFile(path.join(tmp, 'huge.log'), big);
    // A normal source file with the same pattern — must still match.
    await fs.writeFile(path.join(tmp, 'ok.ts'), 'const x = 1;\n// NEEDLE here\n');

    const out = (await grepTool.handler({ pattern: 'NEEDLE' }, baseCtx())) as string;
    expect(out).toContain('ok.ts:2:// NEEDLE here');
    expect(out).not.toContain('huge.log');
  });

  it('skips a binary file (NUL byte) but matches a sibling text file', async () => {
    // Binary content: a NUL byte in the prefix.
    const bin = Buffer.concat([Buffer.from('NEEDLE'), Buffer.from([0x00]), Buffer.from('NEEDLE more')]);
    await fs.writeFile(path.join(tmp, 'blob.bin'), bin);
    await fs.writeFile(path.join(tmp, 'text.ts'), 'NEEDLE in source\n');

    const out = (await grepTool.handler({ pattern: 'NEEDLE' }, baseCtx())) as string;
    expect(out).toContain('text.ts:1:NEEDLE in source');
    expect(out).not.toContain('blob.bin');
  });

  it('match output for ordinary text files is unchanged', async () => {
    await fs.writeFile(path.join(tmp, 'a.ts'), 'foo\nbar foo\nbaz\n');
    const out = (await grepTool.handler({ pattern: 'foo' }, baseCtx())) as string;
    expect(out.split('\n').sort()).toEqual(['a.ts:1:foo', 'a.ts:2:bar foo'].sort());
  });
});

describe('grepTool hardening', () => {
  it('rejects an over-long pattern instead of compiling it', async () => {
    await fs.writeFile(path.join(tmp, 'a.ts'), 'x\n');
    const pattern = 'a'.repeat(1_001);
    await expect(grepTool.handler({ pattern }, baseCtx())).rejects.toThrow(/pattern too long/i);
  });

  it('does not overflow the stack on a deep directory tree (depth ceiling holds)', async () => {
    // Build a tree deeper than MAX_WALK_DEPTH (100) but within the OS PATH_MAX.
    // Unbounded recursion past the ceiling would keep descending; the bound must
    // stop it without crashing, while shallow files still match.
    let cur = tmp;
    for (let i = 0; i < 110; i++) {
      cur = path.join(cur, 'd');
    }
    await fs.mkdir(cur, { recursive: true });
    await fs.writeFile(path.join(tmp, 'top.ts'), 'NEEDLE\n');
    // Must complete (not crash) and still match the shallow file.
    const out = (await grepTool.handler({ pattern: 'NEEDLE' }, baseCtx())) as string;
    expect(out).toContain('top.ts:1:NEEDLE');
  });

  it('refuses an exponential-backtracking pattern instead of running it (no DoS hang)', async () => {
    // `(.*a)+b` against a long all-'a' line is classic exponential backtracking
    // — measured at 60+ s on ~100 chars. A synchronous `re.test()` can't be
    // interrupted, so the linter must refuse it up front, fast.
    await fs.writeFile(path.join(tmp, 'mono.txt'), 'a'.repeat(200_000));
    const start = Date.now();
    await expect(grepTool.handler({ pattern: '(.*a)+b' }, baseCtx())).rejects.toThrow(
      /catastrophic backtracking|nested-quantifier/i,
    );
    // The refusal is a cheap structural check — must return effectively instantly,
    // never having compiled or run the pattern.
    expect(Date.now() - start).toBeLessThan(2_000);
  });

  it('refuses the other classic ReDoS shapes (nested star, alternation-in-group)', async () => {
    await fs.writeFile(path.join(tmp, 'a.txt'), 'x\n');
    await expect(grepTool.handler({ pattern: '(a+)+$' }, baseCtx())).rejects.toThrow(/backtracking|nested/i);
    await expect(grepTool.handler({ pattern: '(a|a)*$' }, baseCtx())).rejects.toThrow(/backtracking|nested/i);
    await expect(grepTool.handler({ pattern: '(\\d+)*x' }, baseCtx())).rejects.toThrow(/backtracking|nested/i);
  });

  it('still allows ordinary patterns with .* and a single group (no false positive)', async () => {
    // A benign `.*` and a single non-repeating group must NOT be refused — these
    // are the bread-and-butter search patterns the model uses constantly.
    await fs.writeFile(path.join(tmp, 'a.ts'), 'import foo from "bar";\n');
    const out1 = (await grepTool.handler({ pattern: 'import.*from' }, baseCtx())) as string;
    expect(out1).toContain('a.ts:1:import foo from');
    const out2 = (await grepTool.handler({ pattern: '(foo|baz)' }, baseCtx())) as string;
    expect(out2).toContain('a.ts:1:');
  });

  it('bounds work on a single huge line for a benign pattern (line-length cap)', async () => {
    // No newline → one array element → the per-line yield never fires. The
    // MAX_LINE_LEN cap must still let this complete quickly with a benign
    // (linear) pattern, matching content in the head.
    await fs.writeFile(path.join(tmp, 'big.txt'), 'HELLO' + 'a'.repeat(2 * 1024 * 1024));
    const start = Date.now();
    const out = (await grepTool.handler({ pattern: 'HELLO' }, baseCtx())) as string;
    expect(out).toContain('big.txt:1:HELLO');
    expect(Date.now() - start).toBeLessThan(5_000);
  }, 10_000);

  it('rejects an over-long glob filter instead of compiling it', async () => {
    await fs.writeFile(path.join(tmp, 'a.ts'), 'x\n');
    const glob = '*'.repeat(5_000); // > MAX_GLOB_LEN (4096)
    await expect(grepTool.handler({ pattern: 'x', glob }, baseCtx())).rejects.toThrow(
      /glob pattern too long/i,
    );
  });

  it('appends a truncation marker when the match cap is hit (does not silently drop)', async () => {
    // Three matching lines, cap at 2 → the model must be told the result is
    // partial so it does not conclude there are no further matches.
    await fs.writeFile(path.join(tmp, 'm.txt'), 'NEEDLE\nNEEDLE\nNEEDLE\n');
    const out = (await grepTool.handler({ pattern: 'NEEDLE', maxMatches: 2 }, baseCtx())) as string;
    expect(out).toMatch(/truncated — reached the 2-match cap/i);
    // The two real matches are still present.
    expect(out.split('\n').filter((l) => l.includes('NEEDLE')).length).toBe(2);
  });
});
