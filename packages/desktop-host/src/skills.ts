/**
 * Skill file CRUD against the user skills directory
 * (`~/.moxxy/skills/*.md`). The runner picks up changes the next time
 * skills are scanned; for now we don't try to hot-reload.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { readFile, readdir, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { writeFileAtomic } from '@moxxy/sdk';
import type { SkillFile } from '@moxxy/desktop-ipc-contract';

/** Pull the frontmatter `description` (cheap regex — no YAML dep) so the
 *  Skills gallery can show what each skill is for without opening it. */
async function readDescription(file: string): Promise<string | undefined> {
  try {
    const raw = await readFile(file, 'utf8');
    const fm = /^---\s*\n([\s\S]*?)\n---/.exec(raw);
    if (!fm) return undefined;
    const m = /^description:\s*(.+)$/m.exec(fm[1]!);
    return m ? m[1]!.trim().replace(/^["']|["']$/g, '') : undefined;
  } catch {
    return undefined;
  }
}

/** Resolved at call time so tests can mock `os.homedir()`. */
function skillsDir(): string {
  return path.join(homedir(), '.moxxy', 'skills');
}

export async function listSkills(): Promise<SkillFile[]> {
  ensureDir();
  try {
    const entries = await readdir(skillsDir());
    const names = entries.filter((name) => name.endsWith('.md')).sort();
    return await Promise.all(
      names.map(async (name) => {
        const description = await readDescription(path.join(skillsDir(), name));
        return { name, editable: true, ...(description ? { description } : {}) };
      }),
    );
  } catch {
    return [];
  }
}

export async function readSkill(name: string): Promise<string> {
  assertSafeName(name);
  return readFile(path.join(skillsDir(), name), 'utf8');
}

export async function writeSkill(name: string, body: string): Promise<void> {
  assertSafeName(name);
  // writeFileAtomic mkdirs the target's dir, so a separate ensureDir() is
  // redundant — and the tmp+rename means a crash mid-write can't truncate an
  // existing skill file.
  await writeFileAtomic(path.join(skillsDir(), name), body);
}

export async function deleteSkill(name: string): Promise<void> {
  assertSafeName(name);
  try {
    await unlink(path.join(skillsDir(), name));
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code !== 'ENOENT') throw err;
  }
}

function assertSafeName(name: string): void {
  // Reject BOTH path separators (`/` POSIX, `\` Windows) explicitly — a bare
  // `path.basename` check can't catch `\` on a POSIX host (it isn't a
  // separator there), so a name like `sub\evil.md` would slip through and land
  // in a subdir once the file lands on a Windows box. `..` blocks traversal and
  // the `.md` suffix keeps the keyspace to skill files.
  if (
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('..') ||
    !name.endsWith('.md')
  ) {
    throw new Error(`invalid skill name: ${name}`);
  }
}

function ensureDir(): void {
  const dir = skillsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
