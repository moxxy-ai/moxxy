import { describe, expect, it } from 'vitest';
import { buildBrief, digestTurns } from './brief.js';

const ev = (o: Record<string, unknown>): unknown => o;

describe('digestTurns', () => {
  it('extracts user prompts and model assistant messages, in order', () => {
    const turns = digestTurns([
      ev({ type: 'user_prompt', text: 'build a blog' }),
      ev({ type: 'assistant_message', source: 'model', content: 'sure, what stack?' }),
      ev({ type: 'assistant_message', source: 'system', content: 'IGNORE system msg' }),
      ev({ type: 'provider_request' }),
      ev({ type: 'user_prompt', text: 'next.js please' }),
    ]);
    expect(turns).toEqual([
      { role: 'user', text: 'build a blog' },
      { role: 'assistant', text: 'sure, what stack?' },
      { role: 'user', text: 'next.js please' },
    ]);
  });
});

describe('buildBrief', () => {
  it('always includes the goal', () => {
    const brief = buildBrief('Ship the onboarding flow', []);
    expect(brief).toContain('# Collaboration brief');
    expect(brief).toContain('## Goal');
    expect(brief).toContain('Ship the onboarding flow');
  });

  it('includes the conversation but does not repeat the goal as the last user turn', () => {
    const brief = buildBrief('next.js please', [
      ev({ type: 'user_prompt', text: 'build a blog' }),
      ev({ type: 'assistant_message', source: 'model', content: 'what stack?' }),
      ev({ type: 'user_prompt', text: 'next.js please' }),
    ]);
    expect(brief).toContain('## Conversation so far');
    expect(brief).toContain('build a blog');
    expect(brief).toContain('what stack?');
    // the trailing user turn equals the goal → not duplicated in the conversation
    expect(brief.match(/next\.js please/g)?.length).toBe(1);
  });

  it('keeps only the most recent turns (window)', () => {
    const events = Array.from({ length: 40 }, (_, i) =>
      ev({ type: 'user_prompt', text: `[i=${i}] short message` }),
    );
    const brief = buildBrief('goal', events);
    // last 12 turns survive; older ones are dropped
    expect(brief).toContain('[i=39]');
    expect(brief).toContain('[i=28]');
    expect(brief).not.toContain('[i=10]');
  });

  it('caps total size even for a huge conversation', () => {
    const huge = 'x'.repeat(5000);
    const events = Array.from({ length: 40 }, () => ev({ type: 'user_prompt', text: huge }));
    const brief = buildBrief('goal', events);
    expect(brief.length).toBeLessThanOrEqual(6001);
  });
});
