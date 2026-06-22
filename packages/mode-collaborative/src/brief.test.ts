import { describe, expect, it } from 'vitest';
import { buildBrief, buildConversation, digestTurns, heuristicSummary } from './brief.js';

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

describe('buildBrief (summary document)', () => {
  it('renders the goal + the provided summary, and points at the recall file', () => {
    const brief = buildBrief('Ship onboarding', '- must be mobile-first\n- no analytics');
    expect(brief).toContain('# Collaboration brief');
    expect(brief).toContain('## Goal');
    expect(brief).toContain('Ship onboarding');
    expect(brief).toContain('## Summary');
    expect(brief).toContain('mobile-first');
    // points at the recall file, does NOT embed the transcript
    expect(brief).toContain('.moxxy-collab/CONVERSATION.md');
  });

  it('guards an oversized summary', () => {
    const brief = buildBrief('goal', 'x'.repeat(9000));
    expect(brief.length).toBeLessThan(5000);
  });
});

describe('heuristicSummary (fallback)', () => {
  it('summarizes the recent turns and flags itself as the fallback', () => {
    const s = heuristicSummary('next.js please', [
      ev({ type: 'user_prompt', text: 'build a blog' }),
      ev({ type: 'assistant_message', source: 'model', content: 'what stack?' }),
      ev({ type: 'user_prompt', text: 'next.js please' }),
    ]);
    expect(s).toContain('heuristic summary');
    expect(s).toContain('build a blog');
    // trailing user turn == goal is not duplicated
    expect(s.match(/next\.js please/g)).toBeNull();
  });

  it('handles an empty conversation', () => {
    expect(heuristicSummary('goal', [])).toContain('no prior conversation');
  });
});

describe('buildConversation (recall file)', () => {
  it('includes EVERY turn (full transcript), not just a window', () => {
    const events = Array.from({ length: 40 }, (_, i) =>
      ev({ type: 'user_prompt', text: `[i=${i}] message` }),
    );
    const conv = buildConversation('goal', events);
    expect(conv).toContain('recall-only');
    // the recall file keeps far more than the 12-turn brief window
    expect(conv).toContain('[i=0]');
    expect(conv).toContain('[i=39]');
  });

  it('caps total size even for a huge conversation', () => {
    const events = Array.from({ length: 200 }, () => ev({ type: 'user_prompt', text: 'x'.repeat(2000) }));
    expect(buildConversation('goal', events).length).toBeLessThanOrEqual(48_001);
  });
});
