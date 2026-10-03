import { describe, expect, it } from 'vitest';
import { asSkillId } from './ids.js';
import type { ToolRegistry } from './mode.js';
import type { Skill, SkillFrontmatter } from './skill.js';
import { insertMention, mentionedSkills, mentionOptions, mentionQueryAt, skillAttachment, withoutTools } from './skill-mentions.js';
import type { SkillInfo } from './session-like.js';
import { defineTool } from './define.js';
import { z } from 'zod';

const skill = (frontmatter: Omit<SkillFrontmatter, 'description'>, body = 'Do it on the desktop.'): Skill => ({
  id: asSkillId(`plugin/${frontmatter.name}`),
  path: `/skills/${frontmatter.name}.md`,
  scope: 'plugin',
  frontmatter: { description: 'test skill', ...frontmatter },
  body,
});

const computer = skill({ name: 'computer-control', aliases: ['computer-use'], 'disallowed-tools': ['browser_*'] });
const browser = skill({ name: 'browser' });

describe('mentionedSkills', () => {
  it('finds a skill the prompt names with @, by an alias written with underscores', () => {
    expect(mentionedSkills('@computer_use otwórz Canvę w Arc', [browser, computer])).toEqual([computer]);
  });

  it('finds a skill by its own name, in any letter case, anywhere in the prompt', () => {
    expect(mentionedSkills('zrób to przez @Computer-Control, proszę', [computer])).toEqual([computer]);
  });

  it('names each skill once however often it is mentioned', () => {
    expect(mentionedSkills('@computer_use i jeszcze raz @computer-control', [computer])).toEqual([computer]);
  });

  it('ignores an e-mail address and a mention of no skill', () => {
    expect(mentionedSkills('napisz do kamil@computer-use.pl o @nobody', [computer])).toEqual([]);
  });
});

describe('skillAttachment', () => {
  it('carries the skill to the model as a file, saying the user asked for it and which tools are off', () => {
    const attachment = skillAttachment(computer);

    expect(attachment).toMatchObject({ kind: 'file', name: 'computer-control skill' });
    expect(attachment.content).toContain('The user called this skill with an @ mention');
    expect(attachment.content).toContain('browser_*');
    expect(attachment.content.endsWith('Do it on the desktop.')).toBe(true);
  });
});

describe('withoutTools', () => {
  const tool = (name: string) => defineTool({ name, description: name, inputSchema: z.object({}), handler: async () => name });
  const registry: ToolRegistry = {
    list: () => [tool('browser_click'), tool('computer_click'), tool('web_fetch')],
    get: (name) => registry.list().find((t) => t.name === name),
    execute: async (name) => name,
  };

  it('leaves the withheld tools out of the list and out of reach by name', async () => {
    const narrowed = withoutTools(registry, ['browser_*']);

    expect(narrowed.list().map((t) => t.name)).toEqual(['computer_click', 'web_fetch']);
    expect(narrowed.get('browser_click')).toBeUndefined();
    await expect(narrowed.execute('computer_click', {}, new AbortController().signal)).resolves.toBe('computer_click');
    await expect(narrowed.execute('browser_click', {}, new AbortController().signal)).rejects.toThrow(/browser_click is off for this request/);
  });
});

describe('mentionQueryAt', () => {
  it('reads the @ word the caret is in, from its @ to its end', () => {
    expect(mentionQueryAt('zrób to @com', 12)).toEqual({ start: 8, end: 12, query: 'com' });
    expect(mentionQueryAt('@comp reszta', 3)).toEqual({ start: 0, end: 5, query: 'comp' });
    expect(mentionQueryAt('@', 1)).toEqual({ start: 0, end: 1, query: '' });
  });

  it('is nothing outside an @ word, in an e-mail address, or after a space', () => {
    expect(mentionQueryAt('zwykły tekst', 5)).toBeNull();
    expect(mentionQueryAt('kamil@gmail', 11)).toBeNull();
    expect(mentionQueryAt('@computer_use ', 14)).toBeNull();
  });
});

describe('mentionOptions', () => {
  const skills: SkillInfo[] = [
    { id: 'builtin/web-research', name: 'web-research', description: 'Research a topic on the web' },
    { id: 'builtin/browser', name: 'browser', label: 'Moxxy Browser', aliases: ['moxxy_browser', 'przegladarka'], description: 'Drive the in-window browser' },
    { id: 'plugin/computer-control', name: 'computer-control', label: 'Computer Use', aliases: ['computer_use', 'komputer'], description: 'Operate desktop apps' },
  ];

  it('offers the labelled skills first, each to be inserted by its first alias', () => {
    expect(mentionOptions(skills, '').map((o) => o.token)).toEqual(['computer_use', 'moxxy_browser', 'web-research']);
    expect(mentionOptions(skills, '')[0]).toEqual({ name: 'computer-control', token: 'computer_use', label: 'Computer Use', description: 'Operate desktop apps' });
  });

  it('matches what was typed against names, aliases and labels, diacritics and _ aside', () => {
    expect(mentionOptions(skills, 'com').map((o) => o.name)).toEqual(['computer-control']);
    expect(mentionOptions(skills, 'przeglą').map((o) => o.name)).toEqual(['browser']);
    expect(mentionOptions(skills, 'computer-u').map((o) => o.name)).toEqual(['computer-control']);
    expect(mentionOptions(skills, 'brow').map((o) => o.name)).toEqual(['browser']);
    expect(mentionOptions(skills, 'zzz')).toEqual([]);
  });

  it('puts a word that starts with the query before one that only holds it', () => {
    expect(mentionOptions(skills, 'res').map((o) => o.name)).toEqual(['web-research']);
    expect(mentionOptions(skills, 'r').map((o) => o.name)).toEqual(['web-research', 'computer-control', 'browser']);
  });
});

describe('insertMention', () => {
  it('replaces the @ word with the token and a space, the caret after it', () => {
    expect(insertMention('zrób @com', { start: 5, end: 9, query: 'com' }, 'computer_use')).toEqual({ text: 'zrób @computer_use ', caret: 19 });
    expect(insertMention('@co reszta', { start: 0, end: 3, query: 'co' }, 'computer_use')).toEqual({ text: '@computer_use reszta', caret: 14 });
  });
});
