import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { preferredCliEntry } from './cli-resolver';

it.each(['0.38.0', '0.39.0', 'invalid'])('does not prefer a stale or unversioned writable CLI (%s)', version => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-floor-'));
  const user = join(dir, 'user'); const resources = join(dir, 'resources');
  const updated = join(user, 'cli/node_modules/@moxxy/cli');
  const bundled = join(resources, 'moxxy-cli');
  try {
    for (const [root, v] of [[updated, version], [bundled, '0.39.0']]) {
      mkdirSync(join(root, 'dist'), { recursive: true });
      writeFileSync(join(root, 'dist/bin.js'), '// fixture');
      writeFileSync(join(root, 'package.json'), JSON.stringify({ version: v }));
    }
    expect(preferredCliEntry(user, resources)).toBe(join(bundled, 'dist/bin.js'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
