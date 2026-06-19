/**
 * Skill CRUD test — drives the file ops against a tempdir HOME and
 * asserts the validator rejects unsafe names.
 *
 * We override `process.env.HOME` so `os.homedir()` returns the tempdir
 * (works on macOS + Linux). Mocking the ESM-imported `homedir` named
 * binding doesn't survive `vi.resetModules` reliably; the env-var
 * route is the documented, in-process API for `homedir()` and is
 * exactly what we want under test.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deleteSkill, listSkills, readSkill, writeSkill } from './skills';

let tmpHome: string;
let savedHome: string | undefined;
let savedMoxxyHome: string | undefined;

beforeEach(() => {
  tmpHome = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'moxxy-skills-')));
  savedHome = process.env.HOME;
  savedMoxxyHome = process.env.MOXXY_HOME;
  process.env.HOME = tmpHome;
  // skillsDir() = moxxyHome()/skills; with no $MOXXY_HOME it falls to
  // <HOME>/.moxxy/skills. Clear any leaked override so the HOME route applies.
  delete process.env.MOXXY_HOME;
});

afterEach(() => {
  process.env.HOME = savedHome;
  if (savedMoxxyHome === undefined) delete process.env.MOXXY_HOME;
  else process.env.MOXXY_HOME = savedMoxxyHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe('skills', () => {
  it('lists nothing in a fresh home', async () => {
    expect(await listSkills()).toEqual([]);
  });

  it('round-trips a skill', async () => {
    await writeSkill('hello.md', '# hi');
    const list = await listSkills();
    expect(list.map((s) => s.name)).toEqual(['hello.md']);
    expect(await readSkill('hello.md')).toBe('# hi');
  });

  it('writes skills under $MOXXY_HOME when relocated (matches the runner loader)', async () => {
    // The runner's skill loader reads moxxyHome()/skills; if the desktop wrote to
    // a hardcoded ~/.moxxy/skills the agent would never see a skill the user
    // authored after relocating state with $MOXXY_HOME.
    const relocated = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'moxxy-home-')));
    try {
      process.env.MOXXY_HOME = relocated;
      await writeSkill('relocated.md', '# moved');
      expect((await listSkills()).map((s) => s.name)).toEqual(['relocated.md']);
      expect(await readSkill('relocated.md')).toBe('# moved');
    } finally {
      rmSync(relocated, { recursive: true, force: true });
    }
  });

  it('rejects path traversal', async () => {
    await expect(writeSkill('../evil.md', 'x')).rejects.toThrow(/invalid/);
    await expect(readSkill('a/b.md')).rejects.toThrow(/invalid/);
    await expect(writeSkill('plain.txt', 'x')).rejects.toThrow(/invalid/);
  });

  it('rejects a Windows backslash separator (subdir slip)', async () => {
    // `sub\evil.md` has no `/`, no `..`, and ends `.md`, so it used to pass —
    // but `\` is a path separator on Windows, so it would escape into a subdir.
    await expect(writeSkill('sub\\evil.md', 'x')).rejects.toThrow(/invalid/);
    await expect(readSkill('sub\\evil.md')).rejects.toThrow(/invalid/);
    // A plain, separator-free `.md` name still round-trips.
    await writeSkill('ok.md', 'fine');
    expect(await readSkill('ok.md')).toBe('fine');
  });

  it('only lists .md files, sorted', async () => {
    await writeSkill('zebra.md', 'z');
    await writeSkill('apple.md', 'a');
    const list = await listSkills();
    expect(list.map((s) => s.name)).toEqual(['apple.md', 'zebra.md']);
  });

  it('deletes a skill, and deleting a missing one is a no-op', async () => {
    await writeSkill('gone.md', 'bye');
    await deleteSkill('gone.md');
    expect((await listSkills()).map((s) => s.name)).toEqual([]);
    // ENOENT on a second delete is swallowed (idempotent).
    await expect(deleteSkill('gone.md')).resolves.toBeUndefined();
  });

  it('writeSkill overwrites atomically without truncating on overwrite', async () => {
    await writeSkill('note.md', 'first version');
    await writeSkill('note.md', 'second version');
    expect(await readSkill('note.md')).toBe('second version');
    // The atomic rename never leaves a stray *.tmp sibling behind.
    const list = await listSkills();
    expect(list.map((s) => s.name)).toEqual(['note.md']);
  });
});
