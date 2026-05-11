import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { asSessionId, asToolCallId, asTurnId } from '@moxxy/sdk';
import type { ToolContext } from '@moxxy/sdk';
import { readTool } from './read.js';
import { writeTool } from './write.js';
import { editTool } from './edit.js';
import { bashTool } from './bash.js';
import { grepTool } from './grep.js';
import { globTool } from './glob.js';

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
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-tools-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('readTool', () => {
  it('reads file with line numbers', async () => {
    await fs.writeFile(path.join(tmp, 'a.txt'), 'one\ntwo\nthree');
    const out = (await readTool.handler({ file_path: 'a.txt' }, baseCtx())) as string;
    expect(out).toContain('1\tone');
    expect(out).toContain('3\tthree');
  });

  it('respects offset/limit', async () => {
    await fs.writeFile(path.join(tmp, 'a.txt'), 'a\nb\nc\nd');
    const out = (await readTool.handler({ file_path: 'a.txt', offset: 1, limit: 2 }, baseCtx())) as string;
    expect(out).toContain('2\tb');
    expect(out).toContain('3\tc');
    expect(out).not.toContain('1\ta');
    expect(out).not.toContain('4\td');
  });
});

describe('writeTool', () => {
  it('writes and creates parent dirs', async () => {
    await writeTool.handler({ file_path: 'nested/dir/file.txt', content: 'hello' }, baseCtx());
    const text = await fs.readFile(path.join(tmp, 'nested/dir/file.txt'), 'utf8');
    expect(text).toBe('hello');
  });
});

describe('editTool', () => {
  it('replaces a unique occurrence', async () => {
    await fs.writeFile(path.join(tmp, 'a.txt'), 'foo bar baz');
    await editTool.handler(
      { file_path: 'a.txt', old_string: 'bar', new_string: 'qux', replace_all: false },
      baseCtx(),
    );
    expect(await fs.readFile(path.join(tmp, 'a.txt'), 'utf8')).toBe('foo qux baz');
  });

  it('errors when old_string is not unique without replace_all', async () => {
    await fs.writeFile(path.join(tmp, 'a.txt'), 'foo foo');
    await expect(
      editTool.handler({ file_path: 'a.txt', old_string: 'foo', new_string: 'bar', replace_all: false }, baseCtx()),
    ).rejects.toThrow(/not unique/);
  });

  it('replace_all replaces every occurrence', async () => {
    await fs.writeFile(path.join(tmp, 'a.txt'), 'foo foo foo');
    await editTool.handler(
      { file_path: 'a.txt', old_string: 'foo', new_string: 'X', replace_all: true },
      baseCtx(),
    );
    expect(await fs.readFile(path.join(tmp, 'a.txt'), 'utf8')).toBe('X X X');
  });

  it('errors when old_string not present', async () => {
    await fs.writeFile(path.join(tmp, 'a.txt'), 'hello');
    await expect(
      editTool.handler({ file_path: 'a.txt', old_string: 'missing', new_string: 'x', replace_all: false }, baseCtx()),
    ).rejects.toThrow(/not found/);
  });
});

describe('bashTool', () => {
  it('runs a command and captures stdout', async () => {
    const out = (await bashTool.handler({ command: 'echo hi', timeoutMs: 5000 }, baseCtx())) as string;
    expect(out).toContain('hi');
    expect(out).toContain('[exit 0]');
  });

  it('captures non-zero exit', async () => {
    const out = (await bashTool.handler({ command: 'exit 3', timeoutMs: 5000 }, baseCtx())) as string;
    expect(out).toContain('[exit 3]');
  });

  it('times out long commands', async () => {
    await expect(
      bashTool.handler({ command: 'sleep 1', timeoutMs: 50 }, baseCtx()),
    ).rejects.toThrow(/timed out/);
  });

  it('respects abort signal', async () => {
    const controller = new AbortController();
    const ctx = { ...baseCtx(), signal: controller.signal };
    const p = bashTool.handler({ command: 'sleep 2', timeoutMs: 5000 }, ctx) as Promise<string>;
    setTimeout(() => controller.abort(), 50);
    const result = await p;
    expect(result).toMatch(/exit/);
  });
});

describe('grepTool', () => {
  it('finds lines matching pattern', async () => {
    await fs.writeFile(path.join(tmp, 'a.ts'), 'const foo = 1\nconst bar = 2');
    await fs.writeFile(path.join(tmp, 'b.ts'), 'foo and foo');
    const out = (await grepTool.handler({ pattern: 'foo', glob: '*.ts' }, baseCtx())) as string;
    expect(out).toContain('a.ts:1');
    expect(out).toContain('b.ts:1');
  });

  it('respects case insensitivity', async () => {
    await fs.writeFile(path.join(tmp, 'a.txt'), 'HELLO');
    const out = (await grepTool.handler({ pattern: 'hello', caseInsensitive: true }, baseCtx())) as string;
    expect(out).toContain('a.txt:1');
  });
});

describe('globTool', () => {
  it('finds files by **/* pattern', async () => {
    await fs.mkdir(path.join(tmp, 'src'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'src/a.ts'), '');
    await fs.writeFile(path.join(tmp, 'src/b.ts'), '');
    await fs.writeFile(path.join(tmp, 'src/c.md'), '');
    const out = (await globTool.handler({ pattern: 'src/**/*.ts' }, baseCtx())) as string;
    expect(out).toContain('src/a.ts');
    expect(out).toContain('src/b.ts');
    expect(out).not.toContain('c.md');
  });
});
