import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverWorkflows, MAX_WORKFLOW_FILE_BYTES } from './loader.js';

const VALID_YAML = `name: keeper
description: a valid workflow
steps:
  - id: s1
    prompt: hi
`;

describe('discoverWorkflows: per-file read robustness', () => {
  let dir: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('skips a file that vanishes between readdir and readFile, keeping the rest', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wf-loader-'));
    await fs.writeFile(path.join(dir, 'keeper.yaml'), VALID_YAML);
    await fs.writeFile(path.join(dir, 'gone.yaml'), VALID_YAML);

    const gonePath = path.join(dir, 'gone.yaml');
    const realReadFile = fs.readFile.bind(fs);
    // Simulate the file being unlinked after readdir saw it: ENOENT on read.
    vi.spyOn(fs, 'readFile').mockImplementation(((p: Parameters<typeof fs.readFile>[0], ...rest: unknown[]) => {
      if (typeof p === 'string' && p === gonePath) {
        const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return Promise.reject(err);
      }
      return (realReadFile as (...a: unknown[]) => Promise<unknown>)(p, ...rest);
    }) as typeof fs.readFile);

    const warnings: Array<Record<string, unknown> | undefined> = [];
    const found = await discoverWorkflows({
      userDir: dir,
      logger: { warn: (_m, meta) => warnings.push(meta) },
    });

    // The valid workflow survives; the vanished one is skipped, not fatal.
    expect(found.map((f) => f.workflow.name)).toEqual(['keeper']);
    expect(warnings.some((w) => w?.path === gonePath)).toBe(true);
  });

  it('skips an oversized workflow file without reading it into memory', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wf-loader-big-'));
    await fs.writeFile(path.join(dir, 'keeper.yaml'), VALID_YAML);
    // A pathological/hostile file past the per-file ceiling. Pad with a YAML
    // comment so it stays valid-shaped but huge — it must be skipped by size,
    // never slurped + parsed.
    const bigPath = path.join(dir, 'huge.yaml');
    const filler = `# ${'x'.repeat(64 * 1024)}\n`;
    let big = VALID_YAML.replace('keeper', 'huge');
    while (big.length <= MAX_WORKFLOW_FILE_BYTES) big += filler;
    await fs.writeFile(bigPath, big);

    // Guard against an accidental regression where the file is read anyway.
    const realReadFile = fs.readFile.bind(fs);
    const readPaths: string[] = [];
    vi.spyOn(fs, 'readFile').mockImplementation(((p: Parameters<typeof fs.readFile>[0], ...rest: unknown[]) => {
      if (typeof p === 'string') readPaths.push(p);
      return (realReadFile as (...a: unknown[]) => Promise<unknown>)(p, ...rest);
    }) as typeof fs.readFile);

    const warnings: Array<Record<string, unknown> | undefined> = [];
    const found = await discoverWorkflows({
      userDir: dir,
      logger: { warn: (_m, meta) => warnings.push(meta) },
    });

    // Only the small valid workflow is discovered; the oversized one is dropped.
    expect(found.map((f) => f.workflow.name)).toEqual(['keeper']);
    // The oversized file was never read into memory (skipped at the stat gate).
    expect(readPaths).not.toContain(bigPath);
    expect(warnings.some((w) => w?.path === bigPath && typeof w?.size === 'number')).toBe(true);
  });
});
