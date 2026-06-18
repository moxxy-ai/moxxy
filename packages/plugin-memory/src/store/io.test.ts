import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { listEntries } from './io.js';

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-io-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function writeEntry(name: string, type = 'fact'): Promise<void> {
  const md =
    `---\nname: ${name}\ntype: ${type}\ndescription: ${name} desc\n` +
    `createdAt: 2026-01-01T00:00:00Z\nupdatedAt: 2026-01-01T00:00:00Z\n---\n\nbody ${name}\n`;
  await fs.writeFile(path.join(tmp, `${name}.md`), md);
}

describe('listEntries', () => {
  it('returns [] for a missing directory', async () => {
    expect(await listEntries(path.join(tmp, 'nope'))).toEqual([]);
  });

  it('parses all .md entries, skipping MEMORY.md and non-md files', async () => {
    await writeEntry('a');
    await writeEntry('b');
    await fs.writeFile(path.join(tmp, 'MEMORY.md'), '# index');
    await fs.writeFile(path.join(tmp, 'notes.txt'), 'ignore me');
    const entries = await listEntries(tmp);
    expect(entries.map((e) => e.frontmatter.name).sort()).toEqual(['a', 'b']);
  });

  it('honors the type filter', async () => {
    await writeEntry('a', 'fact');
    await writeEntry('b', 'preference');
    const facts = await listEntries(tmp, 'fact');
    expect(facts.map((e) => e.frontmatter.name)).toEqual(['a']);
  });

  it('drops files whose frontmatter fails validation (no throw)', async () => {
    await writeEntry('good');
    await fs.writeFile(path.join(tmp, 'bad.md'), '---\nname: bad\n---\nno type\n');
    const entries = await listEntries(tmp);
    expect(entries.map((e) => e.frontmatter.name)).toEqual(['good']);
  });

  it('reads entry files concurrently rather than serially', async () => {
    for (let i = 0; i < 6; i++) await writeEntry(`e${i}`);

    let inFlight = 0;
    let maxInFlight = 0;
    const realRead = fs.readFile.bind(fs);
    const spy = vi
      .spyOn(fs, 'readFile')
      // @ts-expect-error — match the (path, enc) overload we use
      .mockImplementation(async (p: Parameters<typeof realRead>[0], enc) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        try {
          // @ts-expect-error — forward to the real implementation
          return await realRead(p, enc);
        } finally {
          inFlight--;
        }
      });

    const entries = await listEntries(tmp);
    spy.mockRestore();

    // Correctness preserved.
    expect(entries.map((e) => e.frontmatter.name).sort()).toEqual([
      'e0',
      'e1',
      'e2',
      'e3',
      'e4',
      'e5',
    ]);
    // If reads were serialized (await-in-loop) maxInFlight would be 1.
    expect(maxInFlight).toBeGreaterThan(1);
  });
});
