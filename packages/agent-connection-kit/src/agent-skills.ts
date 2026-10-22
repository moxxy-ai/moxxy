import { skillsWithinReach, type AgentToolOutcome, type Skill } from '@moxxy/sdk';
import type { McpCallResult, McpTool } from './mcp-server.js';

/** Moxxy's own tool that reads a skill; the agent calls it under the same name. */
export const LOAD_SKILL = 'load_skill';

/** Claude Code cuts a tool description at 2048 characters (4096 from 2.1.296); the list stays under that. */
const DESCRIPTION_LIMIT = 2000;
/**
 * Claude Code defers MCP tools behind its tool search: the model sees only a
 * name until it searches, so it never reads the skill list. This hint loads the
 * one skill tool with its description; the other agents ignore it. Claude Code
 * keeps the description it read at start for the whole conversation, hence the
 * pointer at the current list in the intro.
 */
export const LOAD_UPFRONT = { 'anthropic/alwaysLoad': true } as const;
const ENTRY_LIMIT = 160;

const INTRO =
  "Read one of the person's Moxxy skills: a playbook they keep in Moxxy for a kind of task. " +
  'When their request matches one, call this with its name first and follow the instructions it returns. ' +
  'Skills added later are not listed here: if the person names one you do not see, call this with no name for the current list.';

/**
 * The Moxxy skills an agent is offered. The person's own (the project's and
 * their user folder's, synthesized ones too) and the skill of a Moxxy feature
 * whose tools the agent is lent this turn (Moxxy Browser, Computer Use: the
 * skills that carry a label). Moxxy's other built-in skills stay out: the
 * agent has its own. A skill named like one of the agent's own is left to the agent's.
 */
export function skillsForAgent(
  skills: ReadonlyArray<Skill>,
  lentToolNames: ReadonlyArray<string>,
  ownSkillNames: ReadonlyArray<string>,
): Skill[] {
  const own = new Set(ownSkillNames.map((name) => name.toLowerCase()));
  return skills.filter((skill) => {
    if (own.has(skill.frontmatter.name.toLowerCase())) return false;
    if (skill.scope === 'project' || skill.scope === 'user') return true;
    return skill.frontmatter.label !== undefined && (skill.frontmatter['allowed-tools'] ?? []).length > 0 && skillsWithinReach([skill], lentToolNames).length === 1;
  });
}

/** The tool through which the agent reads the offered skills, listing as many as its description holds. */
export function skillTool(offered: ReadonlyArray<Skill>): McpTool | undefined {
  if (offered.length === 0) return undefined;
  let description = `${INTRO}\n\nSkills:`;
  for (const [index, skill] of offered.entries()) {
    const entry = `\n${entryOf(skill)}`;
    const rest = offered.length - index;
    const more = `\n- and ${rest} more: call this with no name for the full list.`;
    const last = index === offered.length - 1;
    if (description.length + entry.length + (last ? 0 : more.length) > DESCRIPTION_LIMIT) {
      description += more;
      break;
    }
    description += entry;
  }
  return {
    name: LOAD_SKILL,
    description,
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The name of the skill, as listed. Leave it out for the full list.' } },
    },
    _meta: LOAD_UPFRONT,
  };
}

/** What the agent gets when it calls the skill tool; only an offered skill is read, by Moxxy's own load_skill in the turn. */
export async function readSkill(
  offered: ReadonlyArray<Skill>,
  input: unknown,
  load: (name: string) => Promise<AgentToolOutcome>,
): Promise<McpCallResult> {
  const name = (input as { name?: unknown } | null)?.name;
  if (typeof name !== 'string' || name.trim() === '') return { content: [{ type: 'text', text: fullList(offered) }] };
  const skill = offered.find((entry) => entry.frontmatter.name === name.trim());
  if (!skill) {
    const known = offered.map((entry) => entry.frontmatter.name).join(', ');
    return { content: [{ type: 'text', text: `No Moxxy skill is named "${name}". The skills are: ${known}.` }], isError: true };
  }
  const outcome = await load(skill.frontmatter.name);
  if (!outcome.ok) return { content: [{ type: 'text', text: outcome.message }], isError: true };
  const body = (outcome.output as { body?: unknown } | null)?.body;
  const text = typeof body === 'string' ? body : skill.body;
  return {
    content: [
      {
        type: 'text',
        text: `# ${skill.frontmatter.name}\n\nThe Moxxy tools this skill names are the ones Moxxy's MCP server gives you.\n\n${text}`,
      },
    ],
  };
}

/** Whether two offers read the same to the agent: the same skills, described the same. */
export function sameSkills(a: ReadonlyArray<Skill>, b: ReadonlyArray<Skill>): boolean {
  const signature = (skills: ReadonlyArray<Skill>) => JSON.stringify(skills.map((skill) => [skill.frontmatter.name, skill.frontmatter.description]));
  return signature(a) === signature(b);
}

function fullList(offered: ReadonlyArray<Skill>): string {
  return `Skills:\n${offered.map((skill) => `- ${skill.frontmatter.name}: ${skill.frontmatter.description}`).join('\n')}`;
}

function entryOf(skill: Skill): string {
  const line = `- ${skill.frontmatter.name}: ${skill.frontmatter.description}`;
  return line.length > ENTRY_LIMIT ? `${line.slice(0, ENTRY_LIMIT - 1)}…` : line;
}
