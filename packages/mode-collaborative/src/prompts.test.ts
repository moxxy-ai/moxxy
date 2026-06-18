import { describe, expect, it } from 'vitest';
import { COLLAB_ARCHITECT_PROMPT, COLLAB_PEER_PROMPT } from './prompts.js';

describe('collaboration prompts', () => {
  it('point every agent at the shared brief + memory recall/save', () => {
    for (const p of [COLLAB_ARCHITECT_PROMPT, COLLAB_PEER_PROMPT]) {
      expect(p).toContain('.moxxy-collab/BRIEF.md');
      expect(p).toContain('recall()');
      expect(p).toContain('memory_save');
    }
  });

  it('tell agents to reply to the human (not go silent on a directive/DM)', () => {
    for (const p of [COLLAB_ARCHITECT_PROMPT, COLLAB_PEER_PROMPT]) {
      expect(p).toContain('collab_send to "human"');
      expect(p.toLowerCase()).toContain('human directive');
    }
  });

  it('let the architect assemble a cross-functional team (not all implementers)', () => {
    expect(COLLAB_ARCHITECT_PROMPT).toContain('"role"');
    expect(COLLAB_ARCHITECT_PROMPT.toLowerCase()).toContain('designer');
    expect(COLLAB_ARCHITECT_PROMPT.toLowerCase()).toContain('qa');
    // architect must not put itself in the roster
    expect(COLLAB_ARCHITECT_PROMPT).toContain('do NOT use "architect"');
  });
});
