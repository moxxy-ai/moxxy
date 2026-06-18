import type { SkillsClientView } from '@moxxy/sdk';
import type { ViewContext } from './context.js';
import { fakeSkill } from './fakes.js';

export function makeSkillsView(ctx: ViewContext): SkillsClientView {
  const { requireInfo } = ctx;
  return { list: () => requireInfo().skills.map(fakeSkill) };
}
