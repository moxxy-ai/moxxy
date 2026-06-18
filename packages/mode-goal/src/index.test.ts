import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool, type ProviderEvent } from '@moxxy/sdk';
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

  it('honours a user deny rule (policy) while still auto-approving other tools', async () => {
    let dangerousRan = false;
    const provider = new FakeProvider({
      script: [
        // The model tries the denied tool first…
        toolUseReply('dangerous', { target: 'prod' }, 'd1'),
        // …then a permitted one, then declares done.
        toolUseReply('safe', {}, 's1'),
        toolUseReply('goal_complete', { summary: 'finished without the denied tool' }, 'gc3'),
      ],
    });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive(GOAL_MODE_NAME);
    session.tools.register(
      defineTool({
        name: 'dangerous',
        description: '',
        inputSchema: z.object({ target: z.string() }),
        handler: () => {
          dangerousRan = true;
          return 'boom';
        },
      }),
    );
    session.tools.register(
      defineTool({ name: 'safe', description: '', inputSchema: z.object({}), handler: () => 'ok' }),
    );
    // Same persistent policy engine that backs ~/.moxxy/permissions.json.
    await session.permissions.addDeny({ name: 'dangerous', reason: 'user denied this tool' });
    // Tripwire: goal mode must never fall through to the interactive prompt
    // path. If it did, dispatchToolCall would surface a pre-execute failure.
    session.setPermissionResolver({
      name: 'tripwire-prompt',
      check: async () => {
        throw new Error('interactive prompt fired in goal mode');
      },
    });

    const events = await collectTurn(session, 'do the thing');

    // The deny rule held, with the user's reason…
    const denied = events.find((e) => e.type === 'tool_call_denied');
    if (denied?.type !== 'tool_call_denied') throw new Error('expected a tool_call_denied event');
    expect(denied.decidedBy).toBe('resolver');
    expect(denied.reason).toContain('user denied this tool');
    // …the denied call still produced a well-formed failed tool_result…
    const deniedResult = events.find(
      (e) => e.type === 'tool_result' && e.callId === denied.callId,
    );
    if (deniedResult?.type !== 'tool_result') throw new Error('expected a tool_result for the denial');
    expect(deniedResult.ok).toBe(false);
    // …and the handler never executed.
    expect(dangerousRan).toBe(false);

    // Everything else still auto-approves without prompting (the tripwire
    // would have failed those calls) and the run completes.
    const approvals = events.filter((e) => e.type === 'tool_call_approved');
    expect(approvals.length).toBeGreaterThanOrEqual(2); // safe + goal_complete
    expect(approvals.every((e) => e.type === 'tool_call_approved' && e.mode === 'allow')).toBe(true);
    expect(
      events.some(
        (e) => e.type === 'tool_result' && !e.ok && e.error.message.includes('pre-execute failure'),
      ),
    ).toBe(false);
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

  // u67-2: the cumulative token-budget backstop must stop the run (the exact
  // unbounded-run failure the guard exists to prevent).
  it('stops with goal_budget_exhausted when cumulative usage exceeds the budget', () => {
    // A single reply whose usage blows past GOAL_TOKEN_BUDGET (4M). The budget
    // check runs right after the provider call, before any tool work, so this
    // trips on iteration 1.
    const hugeUsage: ProviderEvent[] = [
      { type: 'message_start', model: 'fake' },
      { type: 'text_delta', delta: 'working...' },
      {
        type: 'message_end',
        stopReason: 'end_turn',
        usage: { inputTokens: 5_000_000, outputTokens: 0 },
      },
    ];
    const provider = new FakeProvider({ script: [hugeUsage] });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive(GOAL_MODE_NAME);

    return collectTurn(session, 'do an expensive thing').then((events) => {
      const exhausted = events.find(
        (e) => e.type === 'plugin_event' && e.subtype === 'goal_budget_exhausted',
      );
      expect(exhausted).toBeDefined();
      if (exhausted?.type !== 'plugin_event') throw new Error('expected goal_budget_exhausted');
      expect((exhausted.payload as { budget: number }).budget).toBe(4_000_000);
      // It did NOT falsely report completion, and a final system message tells
      // the user how to continue.
      expect(
        events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_completed'),
      ).toBe(false);
      const finalMsg = events
        .filter((e) => e.type === 'assistant_message' && e.source === 'system')
        .pop();
      if (finalMsg?.type !== 'assistant_message') throw new Error('expected final system message');
      expect(finalMsg.content).toContain('token budget exhausted');
    });
  });

  // u67-2: the hard iteration cap must end the run with goal_max_iterations + a
  // fatal error when the model never calls goal_complete.
  it('stops with goal_max_iterations when the cap is reached without completing', async () => {
    // The model keeps doing distinct work (varied inputs dodge the stuck-loop
    // detector) and never declares done. ctx.maxIterations=2 bounds the run.
    const provider = new FakeProvider({
      script: [
        toolUseReply('work', { step: 1 }, 'w1'),
        toolUseReply('work', { step: 2 }, 'w2'),
        toolUseReply('work', { step: 3 }, 'w3'),
      ],
    });
    const session = createFakeSession({ provider });
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive(GOAL_MODE_NAME);
    session.tools.register(
      defineTool({
        name: 'work',
        description: '',
        inputSchema: z.object({ step: z.number() }),
        handler: () => 'ok',
      }),
    );

    const events = await collectTurn(session, 'keep working forever', { maxIterations: 2 });

    const cap = events.find(
      (e) => e.type === 'plugin_event' && e.subtype === 'goal_max_iterations',
    );
    expect(cap).toBeDefined();
    if (cap?.type !== 'plugin_event') throw new Error('expected goal_max_iterations');
    expect((cap.payload as { maxIterations: number }).maxIterations).toBe(2);
    // A fatal error closes the run; it did not falsely complete.
    expect(
      events.some((e) => e.type === 'error' && e.kind === 'fatal' && e.message.includes('iteration cap')),
    ).toBe(true);
    expect(
      events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_completed'),
    ).toBe(false);
  });
});
