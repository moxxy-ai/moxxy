import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Skill } from '@moxxy/sdk';
import type { McpServerConfig, McpToolDescriptor } from '../types.js';
import type { AdminSkillRegistryLike } from './types.js';

export interface WriteMcpUsageSkillOptions {
  readonly skillRegistry: AdminSkillRegistryLike | null;
  readonly userSkillsDir: string;
}

/**
 * Compose a deterministic usage skill from the server's tool list.
 * Cheaper and more reliable than a synthesize_skill model call — the
 * descriptors already carry name + description, so the skill body just
 * lays them out as a bulleted checklist. The user can edit the file
 * later if they want a richer playbook.
 */
export function createMcpUsageSkillWriter(
  opts: WriteMcpUsageSkillOptions,
): (
  server: McpServerConfig,
  descriptors: ReadonlyArray<McpToolDescriptor>,
) => Promise<{ path: string; skillName: string } | null> {
  const { skillRegistry, userSkillsDir } = opts;
  return async (server, descriptors) => {
    const skillName = `${server.name}-mcp`;
    if (skillRegistry?.byName(skillName)) {
      // Already exists (likely from a previous attach) — leave it alone
      // so user edits aren't clobbered.
      return null;
    }
    const triggers = [server.name, `${server.name} mcp`, `use ${server.name}`];
    const toolBullets = descriptors
      .map((d) => {
        const wrappedName = `mcp__${server.name}__${d.name}`;
        return `- \`${wrappedName}\` — ${d.description ?? '(no description provided)'}`;
      })
      .join('\n');
    const allowed = descriptors.map((d) => `mcp__${server.name}__${d.name}`);
    const description = `Use the ${server.name} MCP server (${descriptors.length} tools).`.slice(0, 240);
    const frontmatter =
      `---\n` +
      `name: ${skillName}\n` +
      `description: ${description}\n` +
      `triggers:\n${triggers.map((t) => `  - "${t}"`).join('\n')}\n` +
      `allowed-tools:\n${allowed.map((a) => `  - ${a}`).join('\n')}\n` +
      `---\n`;
    const body =
      `When the user wants to work with **${server.name}**, use the MCP tools below. Pick the tool that best matches the user's intent; chain multiple if needed.\n\n` +
      `## Available tools\n\n${toolBullets}\n\n` +
      `## Notes\n\n` +
      `- Every tool above is namespaced \`mcp__${server.name}__*\`.\n` +
      `- Auto-generated when the MCP server was registered. Edit this file by hand to refine the playbook.`;
    const raw = `${frontmatter}\n${body}\n`;
    const filePath = path.join(userSkillsDir, `${skillName}.md`);
    await fs.mkdir(userSkillsDir, { recursive: true });
    await fs.writeFile(filePath, raw, 'utf8');
    if (skillRegistry) {
      // Build a Skill object that mirrors what discoverSkills would
      // produce so /skills, the system-prompt index, and load_skill all
      // see it immediately.
      const skillObject: Skill = {
        id: `user/${skillName}` as Skill['id'],
        path: filePath,
        scope: 'user',
        frontmatter: {
          name: skillName,
          description,
          triggers,
          'allowed-tools': allowed,
        } as Skill['frontmatter'],
        body,
      };
      try {
        skillRegistry.register(skillObject);
      } catch {
        // already registered — fine
      }
    }
    return { path: filePath, skillName };
  };
}
