/**
 * An agent connection: the vendor's own coding agent does the turn. When the
 * active provider has `agentStep`, the shared loop runs one agent turn instead
 * of "call the model, run the tools, repeat", and records what the agent did
 * as ordinary Moxxy events, so every surface shows it like any other turn.
 * The agent is the external boundary, so it is the only stand-in here; the
 * session, the mode and the loop are real.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AGENT_CONNECTION_PLUGIN_ID,
  AGENT_GOAL_SUBTYPE,
  AGENT_SESSION_SUBTYPE,
  autoApproveFromEvents,
  defineMode,
  definePlugin,
  defineTool,
  runReactLoop,
  type AgentStepHost,
  type MoxxyEvent,
  type PermissionResolver,
} from '@moxxy/sdk';
import { collectTurn, type Session } from '@moxxy/core';
import { FakeAgentProvider, createFakeSession } from '@moxxy/testing';
import { defaultModePlugin } from './index.js';

function sessionWith(provider: FakeAgentProvider): Session {
  const session = createFakeSession({ provider });
  session.pluginHost.registerStatic(defaultModePlugin);
  return session;
}

const denyAll: PermissionResolver = { check: async () => ({ mode: 'deny', reason: 'the person said no' }) };

const types = (events: ReadonlyArray<MoxxyEvent>) => events.map((e) => e.type);

describe('an agent connection turn', () => {
  it('hands the person message to the agent and records its text, tool calls and session as Moxxy events', async () => {
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'session', sessionId: 'agent-s1' };
      yield { type: 'text_delta', delta: 'Reading ' };
      yield { type: 'text_delta', delta: 'it.' };
      yield { type: 'message', text: 'Reading it.', stopReason: 'tool_use' };
      yield { type: 'tool_call', callId: 'toolu_1', name: 'Read', input: { file_path: 'a.ts' } };
      yield { type: 'tool_result', callId: 'toolu_1', ok: true, output: 'export const a = 1;' };
      yield { type: 'message', text: 'It exports a.' };
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } };
    });
    const session = sessionWith(provider);

    const events = await collectTurn(session, 'What is in a.ts?');

    expect(provider.received).toHaveLength(0);
    const [step] = provider.steps;
    expect(step?.prompt).toEqual([{ type: 'text', text: 'What is in a.ts?' }]);
    expect(step?.mode).toBe('default');
    expect(step?.resumeSessionId).toBeUndefined();
    expect(step?.sessionId).toBe(String(session.id));
    expect(events.filter((e) => e.type === 'assistant_chunk').map((e) => (e as { delta: string }).delta)).toEqual([
      'Reading ',
      'it.',
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'tool_call_requested', callId: 'toolu_1', name: 'Read', executedBy: 'provider' }),
    );
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_result', callId: 'toolu_1', ok: true }));
    expect(events.filter((e) => e.type === 'assistant_message').map((e) => (e as { content: string }).content)).toEqual([
      'Reading it.',
      'It exports a.',
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'plugin_event',
        pluginId: AGENT_CONNECTION_PLUGIN_ID,
        subtype: AGENT_SESSION_SUBTYPE,
        payload: { provider: 'fake-agent', sessionId: 'agent-s1' },
      }),
    );
    expect(events).toContainEqual(expect.objectContaining({ type: 'provider_response', inputTokens: 10, outputTokens: 5 }));
  });

  it('resumes the agent own session on the next turn, and records the session only when it changes', async () => {
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'session', sessionId: 'agent-s1' };
      yield { type: 'message', text: 'ok' };
    });
    const session = sessionWith(provider);

    await collectTurn(session, 'first');
    const second = await collectTurn(session, 'second');

    expect(provider.steps[1]?.resumeSessionId).toBe('agent-s1');
    expect(second.some((e) => e.type === 'plugin_event' && e.subtype === AGENT_SESSION_SUBTYPE)).toBe(false);
  });

  it('runs a Moxxy tool the agent calls through the permission flow and hands the result back', async () => {
    let fromMoxxy: unknown;
    const provider = new FakeAgentProvider(async function* (req) {
      fromMoxxy = await req.host.runTool({ callId: 'mcp_1', name: 'browser_title', input: { url: 'https://example.com' } });
      yield { type: 'message', text: 'Done.' };
    });
    const session = sessionWith(provider);
    session.tools.register(
      defineTool({
        name: 'browser_title',
        description: 'Read a page title',
        inputSchema: z.object({ url: z.string() }),
        handler: async ({ url }) => `Title of ${url}`,
      }),
    );

    const events = await collectTurn(session, 'title?');

    expect(provider.steps[0]?.tools.map((t) => t.name)).toContain('browser_title');
    expect(fromMoxxy).toEqual({ ok: true, output: 'Title of https://example.com' });
    const request = events.find((e) => e.type === 'tool_call_requested');
    expect(request).toMatchObject({ callId: 'mcp_1', name: 'browser_title' });
    expect(request).not.toHaveProperty('executedBy');
    expect(types(events)).toContain('tool_call_approved');
  });

  it('asks the person before the agent runs its own tool, and records the refusal', async () => {
    let decision: unknown;
    const provider = new FakeAgentProvider(async function* (req) {
      yield { type: 'tool_call', callId: 'toolu_9', name: 'Bash', input: { command: 'rm -rf build' } };
      decision = await req.host.approve({ callId: 'toolu_9', name: 'Bash', input: { command: 'rm -rf build' } });
      yield { type: 'tool_result', callId: 'toolu_9', ok: false, error: 'denied' };
      yield { type: 'message', text: 'I could not run it.' };
    });
    const session = sessionWith(provider);
    session.setPermissionResolver(denyAll);

    const events = await collectTurn(session, 'clean the build');

    expect(decision).toEqual({ allow: false, reason: 'the person said no' });
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'tool_call_denied', callId: 'toolu_9', decidedBy: 'resolver' }),
    );
  });

  it('only consults hooks and standing rules when the agent asks for a policy check', async () => {
    let decision: unknown;
    const provider = new FakeAgentProvider(async function* (req) {
      decision = await req.host.approve({ callId: 'toolu_2', name: 'Read', input: {}, policyOnly: true });
      yield { type: 'message', text: 'ok' };
    });
    const session = sessionWith(provider);
    session.setPermissionResolver(denyAll);

    const events = await collectTurn(session, 'read');

    expect(decision).toEqual({ allow: true });
    expect(types(events)).not.toContain('tool_call_denied');
  });

  it('shows the agent Question through the conversation Questions', async () => {
    let outcome: unknown;
    const provider = new FakeAgentProvider(async function* (req) {
      outcome = await req.host.ask([
        { id: 'q1', question: 'Which colour?', options: [{ id: 'red', label: 'Red' }], multiSelect: false, allowOther: true },
      ]);
      yield { type: 'message', text: 'ok' };
    });
    const session = sessionWith(provider);

    await collectTurn(session, 'make a button');

    // No surface shows questions in this session, so nobody can answer.
    expect(outcome).toEqual({ kind: 'unanswerable' });
  });

  it('takes the agent real approval policy as the conversation auto-approve, and passes it on', async () => {
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'auto_approve', enabled: true };
      yield { type: 'message', text: 'ok' };
    });
    const session = sessionWith(provider);

    await collectTurn(session, 'first');
    expect(autoApproveFromEvents(session.log.ofType('plugin_event'))).toBe(true);
    await collectTurn(session, 'second');
    expect(provider.steps[1]?.autoApprove).toBe(true);
  });

  it('adds no end-of-turn reminder after a turn that ended on a failed step: the agent decides when it is done', async () => {
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'tool_call', callId: 'toolu_3', name: 'Bash', input: { command: 'pnpm test' } };
      yield { type: 'tool_result', callId: 'toolu_3', ok: false, error: 'tests failed' };
      yield { type: 'message', text: 'The tests fail.' };
    });
    const session = sessionWith(provider);

    const events = await collectTurn(session, 'run the tests');

    expect(provider.steps).toHaveLength(1);
    expect(events.filter((e) => e.type === 'user_prompt')).toHaveLength(1);
  });

  it('closes a tool call the agent never finished when the turn is stopped', async () => {
    const controller = new AbortController();
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'tool_call', callId: 'toolu_4', name: 'Bash', input: { command: 'sleep 100' } };
      controller.abort();
    });
    const session = sessionWith(provider);

    const events = await collectTurn(session, 'wait', { signal: controller.signal });

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'tool_result', callId: 'toolu_4', ok: false, error: expect.objectContaining({ kind: 'aborted' }) }),
    );
    expect(types(events)).toContain('abort');
  });

  it('records the state of the agent own goal', async () => {
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'message', text: 'Done: goal.txt says GOAL-DONE.' };
      yield { type: 'goal', status: 'complete' };
    });
    const session = sessionWith(provider);

    const events = await collectTurn(session, 'make goal.txt');

    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'plugin_event',
        pluginId: AGENT_CONNECTION_PLUGIN_ID,
        subtype: AGENT_GOAL_SUBTYPE,
        payload: { provider: 'fake-agent', status: 'complete' },
      }),
    );
  });

  it('ends the turn with the agent error', async () => {
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'error', message: 'claude exited with code 1', retryable: false };
    });
    const session = sessionWith(provider);

    const events = await collectTurn(session, 'hi');

    expect(events).toContainEqual(expect.objectContaining({ type: 'error', kind: 'fatal', message: 'claude exited with code 1' }));
  });
});

describe('a checkpoint that opts into agent connections', () => {
  it('sends the agent its nudge as the next round, until it passes', async () => {
    const provider = new FakeAgentProvider(async function* (req) {
      const first = req.prompt[0];
      yield { type: 'message', text: first && first.type === 'text' && first.text === 'keep going' ? 'done' : 'half way' };
    });
    const session = createFakeSession({ provider });
    let rounds = 0;
    session.pluginHost.registerStatic(
      definePlugin({
        name: '@moxxy/mode-nudged',
        version: '0.0.0',
        modes: [
          defineMode({
            name: 'nudged',
            description: 'runReactLoop with a nudge that works on agent connections',
            run: (ctx) =>
              runReactLoop(ctx, {
                strategyName: 'nudged',
                checkpoints: [
                  {
                    name: 'nudge',
                    agentConnections: true,
                    run: async () => {
                      rounds += 1;
                      return rounds === 1 ? { action: 'inject', text: 'keep going', volatile: true } : { action: 'pass' };
                    },
                  },
                ],
              }),
          }),
        ],
      }),
    );
    session.modes.setActive('nudged');

    await collectTurn(session, 'build it');

    expect(provider.steps.map((step) => step.prompt)).toEqual([
      [{ type: 'text', text: 'build it' }],
      [{ type: 'text', text: 'keep going' }],
    ]);
  });
});

// Keep the host type in the public surface: adapters implement against it.
export type { AgentStepHost };
