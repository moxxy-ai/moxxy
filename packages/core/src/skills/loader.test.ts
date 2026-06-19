import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { discoverSkills } from './loader.js';
import { silentLogger } from '../logger.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-skills-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const writeSkill = async (dir: string, name: string, body = '...') => {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${name}.md`),
    `---\nname: ${name}\ndescription: skill ${name}\ntriggers: [${name}]\n---\n${body}`,
  );
};

describe('discoverSkills', () => {
  it('loads skills from project, user, plugin, and builtin', async () => {
    await writeSkill(path.join(tmp, 'project'), 'a-project');
    await writeSkill(path.join(tmp, 'user'), 'b-user');
    await writeSkill(path.join(tmp, 'plugin'), 'c-plugin');
    await writeSkill(path.join(tmp, 'builtin'), 'd-builtin');

    const skills = await discoverSkills({
      projectDir: path.join(tmp, 'project'),
      userDir: path.join(tmp, 'user'),
      pluginDirs: [path.join(tmp, 'plugin')],
      builtinDir: path.join(tmp, 'builtin'),
      logger: silentLogger,
    });
    const names = skills.map((s) => s.frontmatter.name).sort();
    expect(names).toEqual(['a-project', 'b-user', 'c-plugin', 'd-builtin']);
  });

  it('project scope overrides user/builtin with the same skill name', async () => {
    await writeSkill(path.join(tmp, 'project'), 'shared', 'project body');
    await writeSkill(path.join(tmp, 'user'), 'shared', 'user body');
    await writeSkill(path.join(tmp, 'builtin'), 'shared', 'builtin body');

    const skills = await discoverSkills({
      projectDir: path.join(tmp, 'project'),
      userDir: path.join(tmp, 'user'),
      builtinDir: path.join(tmp, 'builtin'),
      logger: silentLogger,
    });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.scope).toBe('project');
    expect(skills[0]!.body).toContain('project body');
  });

  it('silently skips files with invalid frontmatter', async () => {
    const dir = path.join(tmp, 'project');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'bad.md'), '---\nname: Bad Name\n---\n');
    const skills = await discoverSkills({ projectDir: dir, userDir: path.join(tmp, 'noop'), logger: silentLogger });
    expect(skills).toHaveLength(0);
  });

  it('skips a single unreadable .md but still loads the rest of the tree (u46-5)', async () => {
    // A permission-denied read used to throw out of loadDir and abort discovery
    // of every remaining skill in every source. It must now degrade to skipping
    // just the bad file. (chmod 000 has no teeth as root, so skip there.)
    if (typeof process.getuid === 'function' && process.getuid() === 0) return;
    const dir = path.join(tmp, 'project');
    await writeSkill(dir, 'good-one');
    const badPath = path.join(dir, 'unreadable.md');
    await fs.writeFile(
      badPath,
      '---\nname: unreadable\ndescription: x\ntriggers: [unreadable]\n---\nbody',
    );
    await fs.chmod(badPath, 0o000);
    try {
      const skills = await discoverSkills({
        projectDir: dir,
        userDir: path.join(tmp, 'noop'),
        logger: silentLogger,
      });
      // The valid skill survives even though a sibling .md was unreadable.
      expect(skills.map((s) => s.frontmatter.name)).toEqual(['good-one']);
    } finally {
      // Restore perms so afterEach rm can clean up.
      await fs.chmod(badPath, 0o644).catch(() => {});
    }
  });

  it('returns empty list when directories do not exist', async () => {
    const skills = await discoverSkills({
      projectDir: path.join(tmp, 'no-project'),
      userDir: path.join(tmp, 'no-user'),
      logger: silentLogger,
    });
    expect(skills).toEqual([]);
  });

  it('bounds directory recursion depth (deep tree does not crash, deepest skill skipped)', async () => {
    const root = path.join(tmp, 'project');
    // A shallow skill (loaded) and a very deeply-nested one (beyond the depth cap).
    await writeSkill(root, 'shallow');
    let deep = root;
    for (let i = 0; i < 20; i++) deep = path.join(deep, `lvl${i}`);
    await writeSkill(deep, 'too-deep');

    const skills = await discoverSkills({
      projectDir: root,
      userDir: path.join(tmp, 'noop'),
      logger: silentLogger,
    });
    const names = skills.map((s) => s.frontmatter.name);
    expect(names).toContain('shallow');
    expect(names).not.toContain('too-deep');
  });
});
