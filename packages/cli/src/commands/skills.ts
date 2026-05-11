import { defaultProjectSkillsDir, defaultUserSkillsDir, discoverSkills, silentLogger } from '@moxxy/core';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { ParsedArgv } from '../argv.js';

export async function runSkillsCommand(argv: ParsedArgv): Promise<number> {
  const sub = argv.positional[0] ?? 'list';
  if (sub === 'list') {
    const skills = await discoverSkills({
      projectDir: defaultProjectSkillsDir(process.cwd()),
      userDir: defaultUserSkillsDir(),
      logger: silentLogger,
    });
    for (const s of skills) {
      process.stdout.write(`${s.frontmatter.name}\t${s.scope}\t${s.frontmatter.description}\n`);
    }
    return 0;
  }
  if (sub === 'new') {
    const name = argv.positional[1];
    if (!name) {
      process.stderr.write('usage: moxxy skills new <name>\n');
      return 2;
    }
    const file = path.join(defaultUserSkillsDir(), `${name}.md`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      `---\nname: ${name}\ndescription: TODO\ntriggers: []\nallowed-tools: []\n---\n# ${name}\n\nTODO\n`,
    );
    process.stdout.write(`created ${file}\n`);
    return 0;
  }
  process.stderr.write(`unknown 'skills' subcommand: ${sub}\n`);
  return 2;
}
