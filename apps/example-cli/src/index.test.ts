import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runExample } from './index.js';

let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-example-cli-'));
});
afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

describe('example-cli', () => {
  it('saves a memory in turn 1 and recalls it in turn 2', async () => {
    const result = await runExample({ homeDir: home });
    expect(result.turns).toBe(2);
    expect(result.memorySaved).toBe('team-prefers-trpc');
    expect(result.recalledBody.toLowerCase()).toContain('trpc');

    // Verify the memory was actually written to disk
    const files = await fs.readdir(path.join(home, 'memory'));
    expect(files).toContain('team-prefers-trpc.md');
    expect(files).toContain('MEMORY.md');

    const indexRaw = await fs.readFile(path.join(home, 'memory', 'MEMORY.md'), 'utf8');
    expect(indexRaw).toContain('## preference');
    expect(indexRaw).toContain('[team-prefers-trpc]');
  });
});
