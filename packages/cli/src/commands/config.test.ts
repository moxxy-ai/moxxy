import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runConfigCommand } from './config.js';
import type { ParsedArgv } from '../argv.js';

let tmp: string;
let prevHome: string | undefined;
let out: string[];
let writeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-cfgcmd-'));
  prevHome = process.env.MOXXY_HOME;
  process.env.MOXXY_HOME = tmp;
  out = [];
  writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  }) as never);
});

afterEach(async () => {
  writeSpy.mockRestore();
  if (prevHome === undefined) delete process.env.MOXXY_HOME;
  else process.env.MOXXY_HOME = prevHome;
  await fs.rm(tmp, { recursive: true, force: true });
});

function argv(positional: string[], flags: Record<string, string> = {}): ParsedArgv {
  return { command: 'config', positional, flags, raw: [] } as unknown as ParsedArgv;
}

describe('moxxy config', () => {
  it('set writes the user config, get reads it back merged', async () => {
    expect(await runConfigCommand(argv(['set', 'tui.hints', 'false']))).toBe(0);
    const text = await fs.readFile(path.join(tmp, 'config.yaml'), 'utf8');
    expect(text).toContain('hints: false');
    out.length = 0;
    expect(await runConfigCommand(argv(['get', 'tui.hints']))).toBe(0);
    expect(out.join('')).toContain('false');
  });

  it('get on an unset path reports (unset) with exit 1', async () => {
    expect(await runConfigCommand(argv(['get', 'tui.theme']))).toBe(1);
    expect(out.join('')).toContain('(unset)');
  });

  it('set rejects schema-invalid values', async () => {
    expect(await runConfigCommand(argv(['set', 'tui.theme', 'neon']))).toBe(1);
  });

  it('bare words parse as strings, JSON parses as JSON', async () => {
    expect(await runConfigCommand(argv(['set', 'tui.theme', 'mono']))).toBe(0);
    expect(await runConfigCommand(argv(['set', 'context.caching', 'false']))).toBe(0);
    const text = await fs.readFile(path.join(tmp, 'config.yaml'), 'utf8');
    expect(text).toContain('theme: mono');
    expect(text).toContain('caching: false');
  });

  it('no subcommand prints help with exit 0; unknown subcommand exits 2', async () => {
    expect(await runConfigCommand(argv([]))).toBe(0);
    expect(out.join('')).toContain('moxxy config');
    expect(await runConfigCommand(argv(['frobnicate']))).toBe(2);
  });
});
