import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { removePluginPackage } from './install.js';

describe('removePluginPackage', () => {
  it('uninstalls a package from the user plugins directory', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'moxxy-plugin-remove-'));
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify(
        {
          name: 'moxxy-user-plugins',
          private: true,
          dependencies: {
            'left-pad': '1.3.0',
          },
        },
        null,
        2,
      ),
    );

    try {
      const result = await removePluginPackage({
        packageName: 'left-pad',
        dir,
      });

      const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
      };

      expect(result.removed).toBe('left-pad');
      expect(pkg.dependencies?.['left-pad']).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
