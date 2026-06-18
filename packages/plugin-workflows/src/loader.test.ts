import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverWorkflows } from './loader.js';

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
});
