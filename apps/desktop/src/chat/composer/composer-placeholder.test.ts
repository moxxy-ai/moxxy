import { describe, expect, it } from 'vitest';
import { composerPlaceholder } from './composer-placeholder';

const idle = {
  ready: true,
  compacting: false,
  goalArmed: false,
  inFlight: false,
  hasAttachments: false,
  mode: null,
} as const;

describe('composerPlaceholder', () => {
  it('asks for a message when nothing differs from an ordinary turn', () => {
    expect(composerPlaceholder(idle)).toBe('Message Moxxy…');
    expect(composerPlaceholder({ ...idle, mode: 'default' })).toBe('Message Moxxy…');
  });

  it('asks for what the mode works on', () => {
    expect(composerPlaceholder({ ...idle, mode: 'plan' })).toBe('Describe what to plan…');
    expect(composerPlaceholder({ ...idle, mode: 'research' })).toBe('Ask a research question…');
  });

  it('names the one thing in the way, the most blocking first', () => {
    const busy = { ...idle, inFlight: true, hasAttachments: true, mode: 'plan' };
    expect(composerPlaceholder({ ...busy, compacting: true, ready: false })).toBe('Compacting context…');
    expect(composerPlaceholder({ ...busy, ready: false })).toBe('Waiting for runner…');
    expect(composerPlaceholder(busy)).toBe('Queue a follow-up…');
    expect(composerPlaceholder({ ...idle, hasAttachments: true })).toBe('Ask about the attached file…');
  });

  it('asks for the objective while a goal is armed', () => {
    expect(composerPlaceholder({ ...idle, goalArmed: true, inFlight: true })).toMatch(/goal/i);
  });
});
