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

  it('returns empty list when directories do not exist', async () => {
    const skills = await discoverSkills({
      projectDir: path.join(tmp, 'no-project'),
      userDir: path.join(tmp, 'no-user'),
      logger: silentLogger,
    });
    expect(skills).toEqual([]);
  });
});
