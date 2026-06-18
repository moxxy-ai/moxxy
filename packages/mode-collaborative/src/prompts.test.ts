import { describe, expect, it } from 'vitest';
import { COLLAB_ARCHITECT_PROMPT, COLLAB_PEER_PROMPT, peerPromptWithCharter } from './prompts.js';

describe('collaboration prompts', () => {
  it('point every agent at the shared brief + memory recall/save', () => {
    for (const p of [COLLAB_ARCHITECT_PROMPT, COLLAB_PEER_PROMPT]) {
      expect(p).toContain('.moxxy-collab/BRIEF.md');
      expect(p).toContain('recall()');
      expect(p).toContain('memory_save');
    }
  });

  it('describe the brief as a summary + offer CONVERSATION.md for on-demand recall', () => {
    for (const p of [COLLAB_ARCHITECT_PROMPT, COLLAB_PEER_PROMPT]) {
      expect(p).toContain('.moxxy-collab/CONVERSATION.md');
    }
    // the shared prompt must say the full transcript is NOT auto-loaded
    expect(COLLAB_PEER_PROMPT.toLowerCase()).toContain('do not load it wholesale');
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

  it('ask the architect to author a per-agent charter', () => {
    expect(COLLAB_ARCHITECT_PROMPT).toContain('"charter"');
    expect(COLLAB_ARCHITECT_PROMPT.toLowerCase()).toContain('definition of done');
  });
});

describe('peerPromptWithCharter', () => {
  it('returns the generic peer prompt verbatim when there is no charter', () => {
    expect(peerPromptWithCharter(undefined)).toBe(COLLAB_PEER_PROMPT);
    expect(peerPromptWithCharter('   ')).toBe(COLLAB_PEER_PROMPT);
  });

  it('APPENDS the charter after the authoritative peer prompt (never replaces it)', () => {
    const out = peerPromptWithCharter('You are the QA reviewer. Verify everything.');
    // the authoritative shared rules come first...
    expect(out.startsWith(COLLAB_PEER_PROMPT)).toBe(true);
    // ...then the charter, as a delimited section
    expect(out).toContain('## Your charter');
    expect(out).toContain('You are the QA reviewer.');
    // the charter is never the SOLE prompt — COLLAB_COMMON rules precede it
    expect(out.indexOf('cooperate')).toBeLessThan(out.indexOf('## Your charter'));
  });
});
