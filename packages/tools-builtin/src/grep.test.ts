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
