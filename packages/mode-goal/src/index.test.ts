import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from '@moxxy/sdk';
import { collectTurn } from '@moxxy/core';
import { FakeProvider, createFakeSession, textReply, toolUseReply } from '@moxxy/testing';

import { goalModePlugin, GOAL_MODE_NAME } from './index.js';

describe('goalMode end-to-end', () => {
  it('stops with goal_completed when the model calls goal_complete', async () => {
    const provider = new FakeProvider({
      script: [
        toolUseReply('goal_complete', { summary: 'Refactored the parser', evidence: ['tests pass'] }, 'gc1'),
      ],
    });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive(GOAL_MODE_NAME);

    const events = await collectTurn(session, 'refactor the parser');

    // The run announced it started, then completed (and nothing after).
    expect(events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_started')).toBe(true);
    const completed = events.find((e) => e.type === 'plugin_event' && e.subtype === 'goal_completed');
    expect(completed).toBeDefined();
    if (completed?.type !== 'plugin_event') throw new Error('expected goal_completed');
    expect((completed.payload as { summary: string }).summary).toBe('Refactored the parser');

    // Final system message surfaces the summary to the user.
    const finalMsg = events
      .filter((e) => e.type === 'assistant_message' && e.source === 'system')
      .pop();
    if (finalMsg?.type !== 'assistant_message') throw new Error('expected final system message');
    expect(finalMsg.content).toContain('Refactored the parser');

    // The goal tool actually ran and was auto-approved (no permission prompt).
    expect(
      events.some((e) => e.type === 'tool_call_approved' && e.mode === 'allow'),
    ).toBe(true);
  });

  it('auto-approves a normal tool call mid-run (full autonomy), then completes', async () => {
    const provider = new FakeProvider({
      script: [
        // First the model does real work via a tool…
        toolUseReply('list_dir', { path: '.' }, 'work1'),
        // …then declares done.
        toolUseReply('goal_complete', { summary: 'listed files' }, 'gc2'),
      ],
    });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive(GOAL_MODE_NAME);

    const events = await collectTurn(session, 'list the files then finish');
    // The work tool was auto-approved without any ask/permission round-trip.
    const approvals = events.filter((e) => e.type === 'tool_call_approved');
    expect(approvals.length).toBeGreaterThanOrEqual(2); // work tool + goal_complete
    expect(approvals.every((e) => e.type === 'tool_call_approved' && e.mode === 'allow')).toBe(true);
    expect(events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_completed')).toBe(true);
  });

  it('stalls (goal_stalled) when the model keeps idling without completing', async () => {
    // GOAL_MAX_NOOP_ITERATIONS idle (no-tool) replies → the loop gives up.
    const provider = new FakeProvider({
      script: [
        textReply('Thinking about it...'),
        textReply('Still working through it...'),
        textReply('I believe this is fine.'),
      ],
    });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive(GOAL_MODE_NAME);

    const events = await collectTurn(session, 'do something vague');

    expect(events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_stalled')).toBe(true);
    // It did NOT falsely report completion.
    expect(events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_completed')).toBe(false);
  });

  it('emits a paired result for every request even when the stuck loop trips', async () => {
    // The model hammers the same (name, input) until the detector trips. The
    // stuck trip ends the turn before executeToolUses runs the final request —
    // without synthesizing a result that request is orphaned (renders as a tool
    // stuck "running" forever, flips to error only on the next user_prompt).
    const provider = new FakeProvider({
      script: Array.from({ length: 20 }, (_, i) => toolUseReply('loop', {}, `c${i}`)),
    });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive(GOAL_MODE_NAME);
    session.tools.register(
      defineTool({
        name: 'loop',
        description: '',
        inputSchema: z.object({}),
        handler: () => 'ok',
      }),
    );

    const events = await collectTurn(session, 'spin');
    expect(events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_stuck')).toBe(true);

    const requestedIds = new Set(
      events.filter((e) => e.type === 'tool_call_requested').map((e) => e.callId),
    );
    const resolvedIds = new Set(
      events.filter((e) => e.type === 'tool_result').map((e) => e.callId),
    );
    const orphans = [...requestedIds].filter((id) => !resolvedIds.has(id));
    expect(orphans).toEqual([]);
  });
});
