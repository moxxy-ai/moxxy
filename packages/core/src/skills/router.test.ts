import { describe, expect, it } from 'vitest';
import { asSkillId, type Skill } from '@moxxy/sdk';
import { SkillRouter, buildSkillIndexPrompt } from './router.js';

const skill = (name: string, triggers: string[]): Skill => ({
  id: asSkillId(`user/${name}`),
  path: `/${name}.md`,
  scope: 'user',
  body: '',
  frontmatter: { name, description: `${name} skill`, triggers },
});

describe('SkillRouter', () => {
  it('returns null when no skill matches triggers', async () => {
    const router = new SkillRouter({ skills: [skill('a', ['foo'])] });
    expect(await router.resolve('hello')).toBeNull();
  });

  it('returns the single matching skill at high confidence', async () => {
    const a = skill('a', ['refactor']);
    const router = new SkillRouter({ skills: [a, skill('b', ['deploy'])] });
    const match = await router.resolve('please refactor this component');
    expect(match?.skill.frontmatter.name).toBe('a');
    expect(match?.reason).toBe('trigger_match');
  });

  it('returns first match without a classifier when multiple skills hit', async () => {
    const a = skill('a', ['fix']);
    const b = skill('b', ['fix']);
    const router = new SkillRouter({ skills: [a, b] });
    const match = await router.resolve('please fix the test');
    expect(match?.skill.frontmatter.name).toBe('a');
  });

  it('is case-insensitive on trigger match', async () => {
    const router = new SkillRouter({ skills: [skill('a', ['Refactor'])] });
    const match = await router.resolve('REFACTOR everything');
    expect(match).not.toBeNull();
  });

  it('buildSkillIndexPrompt summarizes name + description', () => {
    const prompt = buildSkillIndexPrompt([skill('a', [])]);
    expect(prompt).toContain('a: a skill');
  });
});
