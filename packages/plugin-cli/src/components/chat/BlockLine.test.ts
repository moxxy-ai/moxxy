import { describe, expect, it } from 'vitest';
import {
  asEventId,
  asSessionId,
  asSkillId,
  asTurnId,
  type SkillInvokedEvent,
} from '@moxxy/sdk';
import type { SkillScopeBlock } from '@moxxy/chat-model';
import { skillActivityPresentation } from './BlockLine.js';

const skillEvent: SkillInvokedEvent = {
  id: asEventId('skill-event'),
  seq: 1,
  ts: 1,
  sessionId: asSessionId('session'),
  turnId: asTurnId('turn'),
  source: 'system',
  type: 'skill_invoked',
  skillId: asSkillId('web-research'),
  name: 'web-research',
  reason: 'load_skill_tool',
};

function scope(overrides: Partial<Pick<SkillScopeBlock, 'loading' | 'closed'>> = {}): SkillScopeBlock {
  return {
    kind: 'skill-scope',
    id: 'scope',
    skillEvent,
    children: [],
    loading: overrides.loading ?? false,
    closed: overrides.closed ?? false,
  };
}

describe('skillActivityPresentation', () => {
  it('shimmers only while load_skill is pending', () => {
    expect(skillActivityPresentation(scope({ loading: true }))).toEqual({
      label: 'web-research',
      meta: null,
      active: true,
    });
    expect(skillActivityPresentation(scope())).toEqual({
      label: 'web-research',
      meta: null,
      active: false,
    });
  });

  it('keeps the top-level skill active while its child scope is working', () => {
    expect(skillActivityPresentation(scope(), 2, true)).toEqual({
      label: 'web-research',
      meta: '2 tools',
      active: true,
    });
    expect(skillActivityPresentation(scope({ closed: true }), 2, false)).toEqual({
      label: 'web-research',
      meta: '2 tools',
      active: false,
    });
  });

  it('omits zero tools and pluralizes non-zero tool counts', () => {
    expect(skillActivityPresentation(scope(), 0).meta).toBeNull();
    expect(skillActivityPresentation(scope(), 1)).toMatchObject({
      label: 'web-research',
      meta: '1 tool',
    });
    expect(skillActivityPresentation(scope({ closed: true }), 2)).toEqual({
      label: 'web-research',
      meta: '2 tools',
      active: false,
    });
  });
});
