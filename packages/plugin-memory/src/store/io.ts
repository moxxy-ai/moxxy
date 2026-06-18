import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { writeFileAtomic } from '@moxxy/sdk';
import { parseMdFile } from '../parse.js';
import {
  memoryFrontmatterSchema,
  type MemoryEntry,
  type MemoryFrontmatter,
  type MemoryType,
} from './types.js';

export async function safeRead(
  filePath: string,
): Promise<{ frontmatter: MemoryFrontmatter; body: string } | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = parseMdFile(raw);
    const result = memoryFrontmatterSchema.safeParse(parsed.frontmatter);
    if (!result.success) return null;
    // Trim the body so safeRead agrees with readEntry/listEntries on the same
    // file — they both `.trim()`. safeRead's only caller (writeEntry) reads just
    // createdAt and discards the body, so this is behavior-preserving today; it
    // removes the latent trap where a future body consumer would see different
    // whitespace depending on which read path it used.
    return { frontmatter: result.data, body: parsed.body.trim() };
  } catch {
    return null;
  }
}

export function isEnoent(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT';
}

export async function listEntries(
  dir: string,
  filterType?: MemoryType,
): Promise<ReadonlyArray<MemoryEntry>> {
  let names: import('node:fs').Dirent[];
  try {
    names = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }
  // recall() and rows() both call this on the hot path; with up to
  // DEFAULT_MAX_MEMORIES (500) entries, reading+parsing each file serially is
  // 500 strictly-ordered disk round-trips. The reads are independent, so fan
  // them out concurrently and preserve dirent order in the result.
  const candidates = names.filter(
    (d) => d.isFile() && d.name.endsWith('.md') && d.name !== 'MEMORY.md',
  );
  const parsed = await Promise.all(
    candidates.map(async (dirent) => {
      const filePath = path.join(dir, dirent.name);
      const raw = await fs.readFile(filePath, 'utf8');
      const md = parseMdFile(raw);
      const result = memoryFrontmatterSchema.safeParse(md.frontmatter);
      if (!result.success) return null;
      if (filterType && result.data.type !== filterType) return null;
      return {
        frontmatter: result.data,
        body: md.body.trim(),
        path: filePath,
      } satisfies MemoryEntry;
    }),
  );
  return parsed.filter((e): e is MemoryEntry => e !== null);
}

export async function readEntry(filePath: string): Promise<MemoryEntry | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = parseMdFile(raw);
    const result = memoryFrontmatterSchema.safeParse(parsed.frontmatter);
    if (!result.success) return null;
    return { frontmatter: result.data, body: parsed.body.trim(), path: filePath };
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

/** What the MEMORY.md index needs per entry — no body, so the incremental
 *  index cache in MemoryStore can feed it without re-reading entry files. */
export type IndexRow = Pick<MemoryEntry, 'frontmatter' | 'path'>;

export async function writeIndex(
  dir: string,
  entries: ReadonlyArray<IndexRow>,
): Promise<void> {
  const lines = ['# Memory index', ''];
  const byType = new Map<MemoryType, IndexRow[]>();
  for (const e of entries) {
    const list = byType.get(e.frontmatter.type) ?? [];
    list.push(e);
    byType.set(e.frontmatter.type, list);
  }
  for (const t of ['fact', 'preference', 'project', 'reference'] as const) {
    const items = byType.get(t);
    if (!items || items.length === 0) continue;
    lines.push(`## ${t}`);
    for (const item of items) {
      lines.push(`- [${item.frontmatter.name}](${path.basename(item.path)}) — ${item.frontmatter.description}`);
    }
    lines.push('');
  }
  await writeFileAtomic(path.join(dir, 'MEMORY.md'), lines.join('\n'));
}
