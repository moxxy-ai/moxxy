import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWorkspaceCatalog } from '../src/workspace-catalog.js';

describe('mobile workspace catalog', () => {
  it('lists and resolves only real desktop desks by cwd for mobile workspace grouping', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moxxy-mobile-workspaces-'));
    const desksPath = join(dir, 'desks.json');
    await writeFile(desksPath, JSON.stringify({
      version: 1,
      activeId: 'desk-new-moxxy',
      desks: [
        {
          id: 'desk-new-moxxy',
          name: 'new_moxxy',
          cwd: '/Users/kamil/new_moxxy',
          color: '#ec4899',
          createdAt: 1780991000000,
        },
      ],
    }));

    const catalog = createWorkspaceCatalog({ desksPath });

    try {
      expect(catalog.resolve('/Users/kamil/new_moxxy')).toEqual({
        id: 'desk-new-moxxy',
        name: 'new_moxxy',
        cwd: '/Users/kamil/new_moxxy',
        color: '#ec4899',
      });
      expect(catalog.list()).toEqual([
        {
          id: 'desk-new-moxxy',
          name: 'new_moxxy',
          cwd: '/Users/kamil/new_moxxy',
          color: '#ec4899',
        },
      ]);
      expect(catalog.resolve('/Users/kamil/other-project')).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
