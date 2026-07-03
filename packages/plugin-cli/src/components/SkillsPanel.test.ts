import { describe, expect, it } from 'vitest';
import { asSkillId, type Skill, type SkillScope } from '@moxxy/sdk';
import { buildSkillRows } from './SkillsPanel.js';

function skill(name: string, scope: SkillScope): Skill {
  return {
    id: asSkillId(`${scope}:${name}`),
    path: `/tmp/${name}.md`,
    scope,
    frontmatter: { name, description: `does ${name}` },
    body: '',
  };
}

describe('buildSkillRows (SkillsPanel)', () => {
  it('orders by scope (user, project, builtin, plugin) then name, and carries description', () => {
    const rows = buildSkillRows([
      skill('zeta', 'builtin'),
      skill('beta', 'user'),
      skill('alpha', 'user'),
    ]);
    expect(rows.map((r) => r.name)).toEqual(['alpha', 'beta', 'zeta']);
    expect(rows[0]!.description).toBe('does alpha');
  });

  it('threads a positive invocation count into row.used, keyed by skill name', () => {
    const rows = buildSkillRows([skill('deploy', 'user')], { deploy: 4 });
    expect(rows[0]!.used).toBe(4);
  });

  it('omits used for a zero/absent count (badge stays hidden)', () => {
    const rows = buildSkillRows(
      [skill('deploy', 'user'), skill('lint', 'user')],
      { deploy: 0 }, // recorded but never invoked; lint has no entry at all
    );
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName['deploy']!.used).toBeUndefined();
    expect(byName['lint']!.used).toBeUndefined();
  });

  it('works with no usage map at all (all badges hidden)', () => {
    const rows = buildSkillRows([skill('deploy', 'user')]);
    expect(rows[0]!.used).toBeUndefined();
  });
});
