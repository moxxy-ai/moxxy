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
    return { frontmatter: result.data, body: parsed.body };
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
  const entries: MemoryEntry[] = [];
  let names: import('node:fs').Dirent[];
  try {
    names = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }
  for (const dirent of names) {
    if (!dirent.isFile()) continue;
    if (!dirent.name.endsWith('.md')) continue;
    if (dirent.name === 'MEMORY.md') continue;
    const filePath = path.join(dir, dirent.name);
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = parseMdFile(raw);
    const result = memoryFrontmatterSchema.safeParse(parsed.frontmatter);
    if (!result.success) continue;
    if (filterType && result.data.type !== filterType) continue;
    entries.push({
      frontmatter: result.data,
      body: parsed.body.trim(),
      path: filePath,
    });
  }
  return entries;
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

export async function writeIndex(
  dir: string,
  entries: ReadonlyArray<MemoryEntry>,
): Promise<void> {
  const lines = ['# Memory index', ''];
  const byType = new Map<MemoryType, MemoryEntry[]>();
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
