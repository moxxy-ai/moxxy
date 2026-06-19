import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ToolDef } from '@moxxy/sdk';
import { buildMemoryPlugin } from './index.js';
import { MemoryStore } from './store.js';

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-idx-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const toolByName = (name: string): ToolDef => {
  const { plugin } = buildMemoryPlugin({ dir: tmp });
  const tool = plugin.tools?.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
};

describe('memory tool input schemas reject path-traversal names', () => {
  // The inproc isolator does NOT enforce the fs.write glob, so these Zod
  // schemas are the sole guard preventing a hallucinated/hostile `name` from
  // reaching fs.unlink / fs.readFile outside the memory dir.
  const traversals = ['../../../etc/passwd', '../escape', 'a/b', '/abs/path', '..', '.hidden', 'Has Space'];

  it.each(['memory_forget', 'memory_update'])('%s rejects traversal names', (toolName) => {
    const schema = toolByName(toolName).inputSchema;
    for (const name of traversals) {
      expect(schema.safeParse({ name }).success).toBe(false);
    }
    // A clean slug still parses.
    expect(schema.safeParse({ name: 'valid-slug-1' }).success).toBe(true);
  });
});

describe('MemoryStore path containment (belt-and-suspenders)', () => {
  it('forget refuses a traversal name instead of unlinking outside the dir', async () => {
    const store = new MemoryStore({ dir: tmp });
    // Plant a sentinel file OUTSIDE the memory dir.
    const outside = path.join(tmp, '..', `sentinel-${path.basename(tmp)}.md`);
    await fs.writeFile(outside, 'do not delete');
    try {
      await expect(store.forget('../' + path.basename(outside).replace(/\.md$/, ''))).rejects.toThrow(
        /invalid memory name/,
      );
      // Sentinel survives.
      await expect(fs.access(outside)).resolves.toBeUndefined();
    } finally {
      await fs.rm(outside, { force: true });
    }
  });

  it('get refuses a name with embedded separators', async () => {
    const store = new MemoryStore({ dir: tmp });
    await expect(store.get('nested/name')).rejects.toThrow(/invalid memory name/);
  });

  it('round-trips a clean slug name unchanged', async () => {
    const store = new MemoryStore({ dir: tmp });
    await store.save({ name: 'clean-slug', type: 'fact', description: 'd', body: 'b' });
    expect((await store.get('clean-slug'))?.frontmatter.name).toBe('clean-slug');
  });
});
