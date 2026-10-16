/**
 * The Moxxy skills a vendor agent is offered over MCP: which ones, how the one
 * tool that reads them looks, and what a call returns.
 */
import { describe, expect, it } from 'vitest';
import type { AgentStepHost, AgentToolCall, Skill, SkillFrontmatter, SkillScope } from '@moxxy/sdk';
import { sameSkills, skillsForAgent, skillTool } from './agent-skills.js';
import { idleToolsHandler, moxxyToolsHandler } from './moxxy-tools.js';

function skill(name: string, scope: SkillScope, extra: Partial<SkillFrontmatter> = {}, body = `Steps for ${name}.`): Skill {
  return {
    id: name as Skill['id'],
    path: `/skills/${name}.md`,
    scope,
    frontmatter: { name, description: `About ${name}`, ...extra },
    body,
  };
}

const deploy = skill('deploy-staging', 'project');
const invoices = skill('monthly-invoices', 'user');
const browser = skill('browser', 'builtin', { label: 'Moxxy Browser', 'allowed-tools': ['browser_click', 'web_fetch'] });
const computer = skill('computer-control', 'plugin', { label: 'Computer Use', 'allowed-tools': ['computer_click'] });
const scheduling = skill('scheduling', 'builtin', { 'allowed-tools': ['schedule_create'] });
const oauth = skill('oauth-flow', 'plugin', { 'allowed-tools': ['oauth_authorize'] });
const names = (skills: ReadonlyArray<Skill>) => skills.map((entry) => entry.frontmatter.name);

describe('the Moxxy skills offered to an agent', () => {
  it("are the person's own, from the project and from their user folder", () => {
    expect(names(skillsForAgent([deploy, invoices, scheduling, oauth], ['schedule_create', 'oauth_authorize'], []))).toEqual([
      'deploy-staging',
      'monthly-invoices',
    ]);
  });

  it('add the skill of a Moxxy feature whose tools the agent is lent', () => {
    expect(names(skillsForAgent([deploy, browser, computer], ['browser_click', 'browser_type'], []))).toEqual(['deploy-staging', 'browser']);
  });

  it("leave a skill to the agent when it has one of that name itself", () => {
    expect(names(skillsForAgent([deploy, invoices, browser], ['browser_click'], ['Deploy-Staging', 'browser']))).toEqual(['monthly-invoices']);
  });
});

describe('the tool through which the agent reads a Moxxy skill', () => {
  it('lists each skill by name with what it is for', () => {
    const tool = skillTool([deploy, invoices]);

    expect(tool?.name).toBe('load_skill');
    expect(tool?.description).toContain('- deploy-staging: About deploy-staging');
    expect(tool?.description).toContain('- monthly-invoices: About monthly-invoices');
    expect(tool?.inputSchema).toMatchObject({ type: 'object', properties: { name: { type: 'string' } } });
  });

  it('loads upfront in an agent that otherwise shows tools only once it searches for them (Claude Code)', () => {
    expect(skillTool([deploy])?._meta).toEqual({ 'anthropic/alwaysLoad': true });
  });

  it('points at the current list, since an agent may keep the description it read first (Claude Code)', () => {
    expect(skillTool([deploy])?.description).toMatch(/added later.*call this with no name for the current list/);
  });

  it('is not there when no skill is offered', () => {
    expect(skillTool([])).toBeUndefined();
  });

  it('stays short enough for an agent that cuts long descriptions, pointing at the full list', () => {
    const many = Array.from({ length: 80 }, (_, n) => skill(`skill-${n}`, 'user', { description: `A long description of what skill ${n} does, `.repeat(3) }));
    const description = skillTool(many)?.description ?? '';

    expect(description.length).toBeLessThanOrEqual(2000);
    expect(description).toContain('- skill-0: ');
    expect(description).toMatch(/and \d+ more: call this with no name for the full list/);
  });
});

describe('the agent reading a Moxxy skill', () => {
  const signal = new AbortController().signal;

  function hostLoading(): { host: Pick<AgentStepHost, 'runTool'>; calls: AgentToolCall[] } {
    const calls: AgentToolCall[] = [];
    return {
      calls,
      host: {
        runTool: async (call) => {
          calls.push(call);
          const name = (call.input as { name: string }).name;
          return { ok: true, output: { name, description: `About ${name}`, scope: 'project', allowedTools: null, body: `Steps for ${name}.` } };
        },
      },
    };
  }

  it("runs Moxxy's load_skill in the turn and hands back the skill's instructions", async () => {
    const { host, calls } = hostLoading();
    const handler = moxxyToolsHandler([], host, [deploy]);

    const result = await handler.call('load_skill', { name: 'deploy-staging' }, signal);

    expect(handler.list().map((tool) => tool.name)).toEqual(['load_skill']);
    expect(calls).toEqual([expect.objectContaining({ name: 'load_skill', input: { name: 'deploy-staging' } })]);
    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('Steps for deploy-staging.') });
  });

  it('gets the full list when it asks with no name, without running anything', async () => {
    const { host, calls } = hostLoading();
    const result = await moxxyToolsHandler([], host, [deploy, invoices]).call('load_skill', {}, signal);

    expect(calls).toEqual([]);
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('- monthly-invoices: About monthly-invoices') });
  });

  it('is told which skills there are when it names one it was not offered', async () => {
    const { host, calls } = hostLoading();
    const result = await moxxyToolsHandler([], host, [deploy]).call('load_skill', { name: 'scheduling' }, signal);

    expect(calls).toEqual([]);
    expect(result).toEqual({ content: [{ type: 'text', text: expect.stringMatching(/No Moxxy skill is named "scheduling".*deploy-staging/s) }], isError: true });
  });

  it('sees the same skills between turns, where nothing runs', async () => {
    const handler = idleToolsHandler([], [deploy]);

    expect(handler.list().map((tool) => tool.name)).toEqual(['load_skill']);
    expect((await handler.call('load_skill', { name: 'deploy-staging' }, signal)).isError).toBe(true);
  });
});

describe('two offers of skills', () => {
  it('read the same when they hold the same skills, described the same', () => {
    const edited = { ...deploy, body: 'New steps.' };
    const redescribed = { ...deploy, frontmatter: { ...deploy.frontmatter, description: 'Ship it' } };

    expect(sameSkills([deploy, invoices], [edited, invoices])).toBe(true);
    expect(sameSkills([deploy], [redescribed])).toBe(false);
    expect(sameSkills([deploy], [deploy, invoices])).toBe(false);
  });
});
