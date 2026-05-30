import { describe, expect, it } from 'vitest';
import { collectTurn } from '@moxxy/core';
import { FakeProvider, createFakeSession, textReply } from '@moxxy/testing';

import { goalModePlugin, GOAL_MODE_NAME, parseCompletion } from './index.js';
import { messageAwaitsUser } from './goal-loop.js';

describe('parseCompletion', () => {
  it('parses GOAL_MET with a summary', () => {
    const out = parseCompletion('VERDICT: GOAL_MET\nSUMMARY: Added foo() and tests pass');
    expect(out.met).toBe(true);
    expect(out.summary).toBe('Added foo() and tests pass');
    expect(out.remaining).toBeNull();
  });

  it('parses GOAL_NOT_MET with a remaining list', () => {
    const out = parseCompletion('VERDICT: GOAL_NOT_MET\nREMAINING:\n- wire the route\n- add a test');
    expect(out.met).toBe(false);
    expect(out.remaining).toBe('- wire the route\n- add a test');
    expect(out.summary).toBeNull();
  });

  it('treats unparseable output as NOT met (fail-safe)', () => {
    const out = parseCompletion('I think it is probably fine, more or less.');
    expect(out.met).toBe(false);
  });
});

describe('messageAwaitsUser', () => {
  it('detects questions and requests for the user', () => {
    expect(messageAwaitsUser('Could you provide the API base URL?')).toBe(true);
    expect(messageAwaitsUser('Please run `/vault set KEY <value>` and let me know.')).toBe(true);
  });
  it('does not fire on completion statements', () => {
    expect(messageAwaitsUser('Done — implemented and verified.')).toBe(false);
    expect(messageAwaitsUser('')).toBe(false);
  });
});

describe('goalMode end-to-end', () => {
  it('stops when the completion check returns GOAL_MET', async () => {
    const provider = new FakeProvider({
      script: [
        textReply('Implemented the requested change.'),
        textReply('VERDICT: GOAL_MET\nSUMMARY: feature added and confirmed'),
      ],
    });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive(GOAL_MODE_NAME);

    const events = await collectTurn(session, 'add a feature');

    expect(
      events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_achieved'),
    ).toBe(true);
    const finalSystem = events
      .filter((e) => e.type === 'assistant_message' && e.source === 'system')
      .pop();
    if (finalSystem?.type !== 'assistant_message') throw new Error('expected a system summary message');
    expect(finalSystem.content).toMatch(/Objective delivered/i);
  });

  it('loops on GOAL_NOT_MET then stops on GOAL_MET', async () => {
    const provider = new FakeProvider({
      script: [
        textReply('Round 1 work.'),
        textReply('VERDICT: GOAL_NOT_MET\nREMAINING:\n- finish the second half'),
        textReply('Round 2 work — finished the rest.'),
        textReply('VERDICT: GOAL_MET\nSUMMARY: all done'),
      ],
    });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive(GOAL_MODE_NAME);

    const events = await collectTurn(session, 'do a two-part task');

    const rounds = events.filter(
      (e) => e.type === 'plugin_event' && e.subtype === 'goal_round_started',
    );
    expect(rounds.length).toBe(2);
    const checks = events.filter(
      (e) => e.type === 'plugin_event' && e.subtype === 'goal_check_completed',
    );
    expect(checks.length).toBe(2);
    expect(events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_achieved')).toBe(true);
  });

  it('pauses (without a completion check) when the model is blocked on the user', async () => {
    const provider = new FakeProvider({
      script: [
        textReply('I need your deploy token. Please run `/vault set DEPLOY_TOKEN <token>` and let me know.'),
      ],
    });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive(GOAL_MODE_NAME);

    const events = await collectTurn(session, 'deploy the app');

    expect(
      events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_awaiting_user'),
    ).toBe(true);
    // It must NOT have run a completion check or declared the goal achieved.
    expect(
      events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_check_completed'),
    ).toBe(false);
    expect(
      events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_achieved'),
    ).toBe(false);
  });
});
