/**
 * How Moxxy conducts herself, whatever surface or mode the conversation is on.
 * Each rule answers a fault seen in a live session: live facts stated without
 * checking, a choice the user settled lost on a redo, and the voice and the
 * agent speaking of themselves in different grammatical genders in one chat.
 */
import { describe, expect, it } from 'vitest';
import type { ProviderRequest } from './provider.js';
import { AGENT_CONDUCT, SELF_REFERENCE_NOTE, withAgentConduct } from './conduct.js';

const request = (system?: string): ProviderRequest => ({
  model: 'm',
  messages: [],
  ...(system !== undefined ? { system } : {}),
});

describe('SELF_REFERENCE_NOTE', () => {
  it('asks for the feminine form, with Polish examples, whatever earlier messages used', () => {
    expect(SELF_REFERENCE_NOTE).toMatch(/feminine/);
    expect(SELF_REFERENCE_NOTE).toContain('sprawdziłam');
    expect(SELF_REFERENCE_NOTE).toContain('never "sprawdziłem"');
    expect(SELF_REFERENCE_NOTE).toMatch(/whatever earlier messages/);
  });
});

describe('AGENT_CONDUCT', () => {
  it('says live facts are only known after checking, and an unchecked one is said to be unchecked', () => {
    expect(AGENT_CONDUCT).toMatch(/prices, timetables, availability/);
    expect(AGENT_CONDUCT).toMatch(/Check them with a tool before stating them/);
    expect(AGENT_CONDUCT).toMatch(/say plainly that you have not checked/);
  });

  it('carries every choice the user settled into a redo of earlier work', () => {
    expect(AGENT_CONDUCT).toMatch(/carry over every choice the user already settled/);
    expect(AGENT_CONDUCT).toMatch(/one-way or return/);
  });

  it('holds the self-reference rule the voice uses too', () => {
    expect(AGENT_CONDUCT).toContain(SELF_REFERENCE_NOTE);
  });
});

describe('withAgentConduct', () => {
  it('sets the conduct as the system text when a request has none', () => {
    expect(withAgentConduct(request()).system).toBe(AGENT_CONDUCT);
  });

  it('appends it after system text another plugin already added', () => {
    expect(withAgentConduct(request('[user-model] likes tea')).system).toBe(`[user-model] likes tea\n\n${AGENT_CONDUCT}`);
  });

  it('adds it once, so a request passed through twice stays byte-identical', () => {
    const once = withAgentConduct(request('x'));
    expect(withAgentConduct(once)).toBe(once);
  });

  it('leaves everything else in the request as it was', () => {
    const req: ProviderRequest = { model: 'm', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], maxTokens: 9 };
    const out = withAgentConduct(req);
    expect(out).toMatchObject({ model: 'm', messages: req.messages, maxTokens: 9 });
  });
});
