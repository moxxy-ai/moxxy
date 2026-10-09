import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { removeTree } from './remove-tree';

describe('removeTree', () => {
  it('removes a folder with everything in it, an app.asar included', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'remove-tree-'));
    const resources = path.join(root, 'Moxxy.app', 'Contents', 'Resources');
    mkdirSync(resources, { recursive: true });
    writeFileSync(path.join(resources, 'app.asar'), 'not a real archive');

    await removeTree(path.join(root, 'Moxxy.app'));

    expect(existsSync(path.join(root, 'Moxxy.app'))).toBe(false);
    expect(existsSync(root)).toBe(true);
  });

  it('has nothing to do when the folder is not there', async () => {
    await expect(removeTree(path.join(os.tmpdir(), 'remove-tree-never-made'))).resolves.toBeUndefined();
  });
});
