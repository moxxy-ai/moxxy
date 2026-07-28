import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every gap between transcript entries must go through `blockGap()`.
 *
 * A hardcoded `marginTop={1}` still renders fine, which is what makes this
 * worth a test: `tui.density: compact` would tighten most entries and leave
 * that one padded, so the setting looks half-broken rather than absent. The
 * failure is invisible to a typechecker and easy to reintroduce by copying an
 * existing component.
 */
const CHAT_DIR = path.dirname(fileURLToPath(import.meta.url));

describe('transcript density coverage', () => {
  it('has no hardcoded vertical separator left in a chat component', async () => {
    const files = (await fs.readdir(CHAT_DIR)).filter(
      (f) => f.endsWith('.tsx') && !f.includes('.test.'),
    );
    expect(files.length).toBeGreaterThan(5);

    const offenders: string[] = [];
    for (const file of files) {
      const source = await fs.readFile(path.join(CHAT_DIR, file), 'utf8');
      if (/marginTop=\{1\}/.test(source)) offenders.push(file);
    }

    expect(offenders, 'use marginTop={blockGap()} so `tui.density` reaches these').toEqual([]);
  });
});
