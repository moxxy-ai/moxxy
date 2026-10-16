/**
 * Skill file CRUD against the user skills directory
 * (`~/.moxxy/skills/*.md` and `~/.moxxy/skills/<name>/SKILL.md`). The runner picks up changes the next time
 * skills are scanned; for now we don't try to hot-reload.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { readFile, readdir, rm, unlink } from 'node:fs/promises';
import path from 'node:path';
import { moxxyHome, writeFileAtomic } from '@moxxy/sdk/server';
import { parseFrontmatterFile, skillFrontmatterSchema } from '@moxxy/sdk';
import type { SkillFile } from '@moxxy/desktop-ipc-contract';

const FOLDER_SKILL_FILE = 'SKILL.md';

/** Read what the gallery shows for one skill file: its `description`, and —
 *  when the runner's loader would drop the file — the reason, so a skill that
 *  cannot load is listed with its problem instead of silently missing. */
async function inspectSkill(file: string): Promise<Pick<SkillFile, 'description' | 'problem'>> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return { problem: 'The file cannot be read.' };
  }
  const { frontmatter } = parseFrontmatterFile(raw);
  const description = typeof frontmatter.description === 'string' ? frontmatter.description.trim() : undefined;
  const parsed = skillFrontmatterSchema.safeParse(frontmatter);
  const problem = parsed.success ? undefined : describeIssues(parsed.error.issues);
  return { ...(description ? { description } : {}), ...(problem ? { problem } : {}) };
}

function describeIssues(issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>): string {
  return issues.map((issue) => `${issue.path.join('.') || 'frontmatter'}: ${issue.message}`).join('; ');
}

/** Resolved at call time so tests can mock the home dir. Routes through
 *  moxxyHome() so $MOXXY_HOME relocates skills consistently with the runner's
 *  own skill loader (which also reads moxxyHome()/skills). */
function skillsDir(): string {
  return path.join(moxxyHome(), 'skills');
}

/** Flat `<name>.md` files plus folder skills (`<name>/SKILL.md`, the layout
 *  `npx skills` and Claude Code use) — the same files the runner's loader reads.
 *  Other `.md` files inside a skill folder are its references, not skills. */
export async function listSkills(): Promise<SkillFile[]> {
  ensureDir();
  try {
    const entries = await readdir(skillsDir(), { withFileTypes: true });
    const names: string[] = [];
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) names.push(entry.name);
      else if (entry.isDirectory() && existsSync(path.join(skillsDir(), entry.name, FOLDER_SKILL_FILE))) {
        names.push(`${entry.name}/${FOLDER_SKILL_FILE}`);
      }
    }
    names.sort();
    return await Promise.all(
      names.map(async (name) => ({ name, editable: true, ...(await inspectSkill(skillPath(name))) })),
    );
  } catch {
    return [];
  }
}

export async function readSkill(name: string): Promise<string> {
  assertSafeName(name);
  return readFile(skillPath(name), 'utf8');
}

export async function writeSkill(name: string, body: string): Promise<void> {
  assertSafeName(name);
  // writeFileAtomic mkdirs the target's dir, so a separate ensureDir() is
  // redundant — and the tmp+rename means a crash mid-write can't truncate an
  // existing skill file.
  await writeFileAtomic(skillPath(name), body);
}

export async function deleteSkill(name: string): Promise<void> {
  assertSafeName(name);
  const folder = skillFolder(name);
  if (folder) {
    // A folder skill is the whole folder — its reference files go with it.
    await rm(path.join(skillsDir(), folder), { recursive: true, force: true });
    return;
  }
  try {
    await unlink(skillPath(name));
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code !== 'ENOENT') throw err;
  }
}

function skillPath(name: string): string {
  const folder = skillFolder(name);
  return folder ? path.join(skillsDir(), folder, FOLDER_SKILL_FILE) : path.join(skillsDir(), name);
}

/** The folder of a `<folder>/SKILL.md` name, or undefined for a flat file. */
function skillFolder(name: string): string | undefined {
  const parts = name.split('/');
  return parts.length === 2 && parts[1] === FOLDER_SKILL_FILE ? parts[0] : undefined;
}

function assertSafeName(name: string): void {
  // Reject `\` explicitly — a bare `path.basename` check can't catch it on a
  // POSIX host (it isn't a separator there), so `sub\evil.md` would land in a
  // subdir once the file reaches a Windows box. `/` is allowed only as the one
  // separator of a folder skill (`<folder>/SKILL.md`). `..` blocks traversal
  // and the `.md` suffix keeps the keyspace to skill files.
  const folder = skillFolder(name);
  const base = folder ?? name;
  if (
    base.length === 0 ||
    base.includes('/') ||
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
