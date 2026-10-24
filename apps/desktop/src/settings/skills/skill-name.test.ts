import { describe, expect, it } from 'vitest';
import { skillDisplayName } from './skill-name';

describe('skillDisplayName', () => {
  it('drops the .md of a flat skill file', () => {
    expect(skillDisplayName('web-research.md')).toBe('web-research');
  });

  it('names a folder skill by its folder', () => {
    expect(skillDisplayName('animate/SKILL.md')).toBe('animate');
  });
});
