/**
 * An agent connection: the vendor's own coding agent does the turn. When the
 * active provider has `agentStep`, the shared loop runs one agent turn instead
 * of "call the model, run the tools, repeat", and records what the agent did
 * as ordinary Moxxy events, so every surface shows it like any other turn.
 * The agent is the external boundary, so it is the only stand-in here; the
 * session, the mode and the loop are real.
 */
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  AGENT_ACCOUNT_LIMIT_SUBTYPE,
  AGENT_CONNECTION_PLUGIN_ID,
  AGENT_CONTEXT_WINDOW_SUBTYPE,
  AGENT_GOAL_SUBTYPE,
  AGENT_NO_REPLY_SUBTYPE,
  AGENT_SESSION_SUBTYPE,
  AUTO_APPROVE_PLUGIN_ID,
  autoApproveFromEvents,
  defineMode,
  definePlugin,
  defineTool,
  isAgentNoReplyEvent,
  recordedAccountLimit,
  runReactLoop,
  type AgentStepEvent,
  type AgentStepHost,
  type MoxxyEvent,
  type PermissionResolver,
  type Skill,
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

  it('hands fast mode to the agent, which runs it on its own faster tier', async () => {
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'message', text: 'ok' };
    });
    const session = sessionWith(provider);

    session.fast = true;
    await collectTurn(session, 'quick');
    session.fast = false;
    await collectTurn(session, 'slow');

    expect(provider.steps.map((step) => step.fast)).toEqual([true, undefined]);
    await session.close();
  });

  it('runs the agent at low effort until the person picks one, and says so', async () => {
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'message', text: 'ok' };
    });
    const session = sessionWith(provider);

    expect(session.getInfo().reasoningEffort).toBe('low');
    await collectTurn(session, 'first');
    session.reasoning = { effort: 'high' };
    await collectTurn(session, 'second');
    session.reasoning = true;
    await collectTurn(session, 'third');

    expect(provider.steps.map((step) => step.reasoning)).toEqual([{ effort: 'low' }, { effort: 'high' }, { effort: 'low' }]);
    expect(session.getInfo().reasoningEffort).toBe('low');
    await session.close();
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

  it("hands the agent the conversation's skills as they are at each turn", async () => {
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'message', text: 'Done.' };
    });
    const session = sessionWith(provider);
    const skill = (name: string) => ({
      id: name as Skill['id'],
      path: `/skills/${name}.md`,
      scope: 'user' as const,
      frontmatter: { name, description: `About ${name}` },
      body: 'Steps.',
    });
    session.skills.register(skill('monthly-invoices'));

    await collectTurn(session, 'first');
    session.skills.register(skill('deploy-staging'));
    await collectTurn(session, 'second');

    expect(provider.steps.map((step) => step.skills?.map((s) => s.frontmatter.name))).toEqual([
      ['monthly-invoices'],
      ['monthly-invoices', 'deploy-staging'],
    ]);
  });

  it('lists the tools of every mode to the agent, and records why one this mode does not offer was not run', async () => {
    let fromMoxxy: unknown;
    const provider = new FakeAgentProvider(async function* (req) {
      fromMoxxy = await req.host.runTool({ callId: 'mcp_1', name: 'goal_only', input: {} });
      yield { type: 'message', text: 'Done.' };
    });
    const session = sessionWith(provider);
    let ran = false;
    session.tools.register(
      defineTool({
        name: 'goal_only',
        description: 'Only in goal mode',
        inputSchema: z.object({}),
        modes: ['goal'],
        handler: async () => {
          ran = true;
          return 'ran';
        },
      }),
    );

    const events = await collectTurn(session, 'go');

    expect(provider.steps[0]?.allTools?.map((t) => t.name)).toContain('goal_only');
    expect(provider.steps[0]?.tools.map((t) => t.name)).not.toContain('goal_only');
    expect(ran).toBe(false);
    expect(fromMoxxy).toEqual({ ok: false, message: expect.stringMatching(/^goal_only is not available in default mode/) });
    expect(events.find((e) => e.type === 'tool_call_requested')).toMatchObject({ callId: 'mcp_1', name: 'goal_only' });
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ callId: 'mcp_1', ok: false, error: { kind: 'denied' } });
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

  it("tells the agent whether the conversation's auto-approve was recorded, so its own setup shows only until then", async () => {
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'message', text: 'ok' };
    });
    const session = sessionWith(provider);

    await collectTurn(session, 'first');
    await session.setAutoApprove(true);
    await session.setAutoApprove(false);
    await collectTurn(session, 'second');

    expect(provider.steps.map((step) => [step.autoApprove, step.autoApproveRecorded])).toEqual([
      [false, false],
      [false, true],
    ]);
  });

  it("tells the agent when auto-approve is its own setup Moxxy took on, not the person's choice", async () => {
    const provider = new FakeAgentProvider(async function* (req) {
      if (req.prompt[0]?.type === 'text' && req.prompt[0].text === 'first') yield { type: 'auto_approve', enabled: true };
      yield { type: 'message', text: 'ok' };
    });
    const session = sessionWith(provider);

    await collectTurn(session, 'first');
    await collectTurn(session, 'second');
    await session.setAutoApprove(false);
    await session.setAutoApprove(true);
    await collectTurn(session, 'third');

    expect(provider.steps.map((step) => step.autoApproveFromAgent)).toEqual([false, true, false]);
  });

  it('records why auto-approve changed outside Moxxy, and a change Moxxy set back, for the conversation to say so', async () => {
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'auto_approve', enabled: true };
      yield { type: 'auto_approve', enabled: false, elsewhere: true };
      yield { type: 'auto_approve_restored' };
      yield { type: 'message', text: 'ok' };
    });
    const session = sessionWith(provider);

    await collectTurn(session, 'first');

    const notes = session.log.ofType('plugin_event').filter((e) => e.pluginId === AUTO_APPROVE_PLUGIN_ID);
    expect(notes.map((e) => [e.subtype, e.payload])).toEqual([
      ['auto_approve', { enabled: true }],
      ['auto_approve', { enabled: false, elsewhere: true }],
      ['auto_approve_restored', { provider: provider.name }],
    ]);
    expect(autoApproveFromEvents(session.log.ofType('plugin_event'))).toBe(false);
  });

  it("records the agent's own subagents the way Moxxy records its own, so every surface shows them", async () => {
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'subagent_started', id: 'sub-1', label: 'List files', agentType: 'Explore', prompt: 'list the files' };
      yield { type: 'subagent_tool_call', id: 'sub-1', name: 'Bash', input: { command: 'ls' } };
      yield { type: 'subagent_completed', id: 'sub-1', text: 'Two files.', tokensUsed: 1200 };
      yield { type: 'message', text: 'It found two files.' };
    });
    const session = sessionWith(provider);

    await collectTurn(session, 'ask a helper');

    const subagents = session.log.ofType('plugin_event').filter((e) => e.pluginId === '@moxxy/subagents');
    expect(subagents.map((e) => [e.subtype, e.payload])).toEqual([
      ['subagent_started', { childSessionId: 'sub-1', label: 'List files', agentType: 'Explore', prompt: 'list the files' }],
      ['subagent_tool_call', { childSessionId: 'sub-1', label: 'List files', name: 'Bash', input: { command: 'ls' } }],
      ['subagent_completed', { childSessionId: 'sub-1', label: 'List files', text: 'Two files.', agentType: 'Explore', stopReason: 'end_turn', tokensUsed: 1200 }],
    ]);
  });

  it('records a subagent the person stopped as stopped, not as failed', async () => {
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'subagent_started', id: 'sub-1', label: 'List files', agentType: 'Explore' };
      yield { type: 'subagent_completed', id: 'sub-1', text: '', error: 'The subagent was stopped.', stopped: true };
      yield { type: 'message', text: 'ok' };
    });
    const session = sessionWith(provider);

    await collectTurn(session, 'ask a helper');

    const ended = session.log.ofType('plugin_event').find((e) => e.subtype === 'subagent_completed');
    expect(ended?.payload).toMatchObject({ stopReason: 'stopped', error: 'The subagent was stopped.' });
  });

  it("records what a subagent says as it works, so its mini chat shows more than its tools", async () => {
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'subagent_started', id: 'sub-1', label: 'List files', agentType: 'Explore' };
      yield { type: 'subagent_message', id: 'sub-1', text: 'Looking at the folder first.' };
      yield { type: 'message', text: 'ok' };
    });
    const session = sessionWith(provider);

    await collectTurn(session, 'ask a helper');

    const said = session.log.ofType('plugin_event').filter((e) => e.subtype === 'subagent_message');
    expect(said.map((e) => [e.pluginId, e.payload])).toEqual([['@moxxy/subagents', { childSessionId: 'sub-1', label: 'List files', text: 'Looking at the folder first.' }]]);
  });

  it('records what the agent runs in the background as one list, and how each work ended', async () => {
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'background_work', work: [{ id: 'b1', kind: 'command', label: 'npm run dev' }] };
      yield { type: 'background_work_ended', id: 'b1', kind: 'command', label: 'npm run dev', status: 'stopped', output: 'ready on :5173' };
      yield { type: 'background_work', work: [] };
      yield { type: 'message', text: 'ok' };
    });
    const session = sessionWith(provider);

    await collectTurn(session, 'start the server');

    const work = session.log.ofType('plugin_event').filter((e) => e.pluginId === AGENT_CONNECTION_PLUGIN_ID && e.subtype.startsWith('background_work'));
    expect(work.map((e) => [e.subtype, e.payload])).toEqual([
      ['background_work', { provider: provider.name, work: [{ id: 'b1', kind: 'command', label: 'npm run dev' }] }],
      ['background_work_ended', { provider: provider.name, id: 'b1', kind: 'command', label: 'npm run dev', status: 'stopped', output: 'ready on :5173' }],
      ['background_work', { provider: provider.name, work: [] }],
    ]);
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

  it('shows the agent own plan as its message when the mode has no plan card', async () => {
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'plan', text: '# Fix add\n\n- Change - to +.' };
    });
    const session = sessionWith(provider);

    const events = await collectTurn(session, 'plan the fix');

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'assistant_message', source: 'model', content: '# Fix add\n\n- Change - to +.' }),
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

describe("the agent's account limit", () => {
  const limitsIn = (events: ReadonlyArray<MoxxyEvent>) =>
    events.filter((e) => e.type === 'plugin_event' && e.subtype === AGENT_ACCOUNT_LIMIT_SUBTYPE).map((e) => (e as { payload: unknown }).payload);

  it('records the limit the agent reports, again only when it reads differently', async () => {
    let used = 91.2;
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'account_limit', limit: { state: 'near', usedPercent: used, windowMinutes: 10080, resetsAt: 9_000_000 } };
      yield { type: 'message', text: 'Hi.' };
    });
    const session = sessionWith(provider);

    const first = await collectTurn(session, 'hi');
    used = 91.6;
    const same = await collectTurn(session, 'hi again');
    used = 93;
    const more = await collectTurn(session, 'and again');

    expect(limitsIn(first)).toEqual([
      { provider: 'fake-agent', limit: { state: 'near', usedPercent: 91.2, windowMinutes: 10080, resetsAt: 9_000_000 } },
    ]);
    expect(limitsIn(same)).toEqual([]);
    expect(limitsIn(more)).toHaveLength(1);
  });

  it('ends the turn on a reached limit with the limit alone, not the raw error the agent gave with it', async () => {
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'account_limit', limit: { state: 'reached', windowMinutes: 300, resetsAt: 9_000_000 } };
      yield { type: 'error', message: "Claude Code: You've hit your limit · resets 6pm", retryable: false };
    });
    const session = sessionWith(provider);

    const events = await collectTurn(session, 'hi');

    expect(limitsIn(events)).toEqual([{ provider: 'fake-agent', limit: { state: 'reached', windowMinutes: 300, resetsAt: 9_000_000 } }]);
    expect(types(events)).not.toContain('error');
  });

  it('keeps the reset it knows when the agent says again the limit is used up, without saying when it resets', async () => {
    const saturday = Date.now() + 2 * 24 * 60 * 60 * 1000;
    let report: { state: 'reached'; windowMinutes?: number; resetsAt?: number } = { state: 'reached', windowMinutes: 10080, resetsAt: saturday };
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'account_limit', limit: report };
      yield { type: 'error', message: "You've hit your weekly limit", retryable: false };
    });
    const session = sessionWith(provider);

    await collectTurn(session, 'hi');
    report = { state: 'reached' };
    const again = await collectTurn(session, 'hi again');

    expect(limitsIn(again)).toEqual([]);
    expect(recordedAccountLimit(session.log.ofType('plugin_event'), 'fake-agent')?.limit).toEqual({ state: 'reached', windowMinutes: 10080, resetsAt: saturday });
  });

  it('records a used-up limit as the agent says it once the reset it knew has passed', async () => {
    let report: { state: 'reached'; windowMinutes?: number; resetsAt?: number } = { state: 'reached', windowMinutes: 300, resetsAt: Date.now() - 1000 };
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'account_limit', limit: report };
    });
    const session = sessionWith(provider);

    await collectTurn(session, 'hi');
    report = { state: 'reached' };
    const again = await collectTurn(session, 'hi again');

    expect(limitsIn(again)).toEqual([{ provider: 'fake-agent', limit: { state: 'reached' } }]);
  });
});

describe('how full the agent context is', () => {
  const response = (events: ReadonlyArray<MoxxyEvent>) => events.find((e) => e.type === 'provider_response');

  it('reports the context the agent says it holds, apart from the usage its turn added up', async () => {
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'usage', usage: { inputTokens: 1_000, outputTokens: 50, cacheReadTokens: 150_000 } };
      yield { type: 'usage', usage: { inputTokens: 2_000, outputTokens: 80, cacheReadTokens: 151_000 } };
      yield { type: 'context_used', tokens: 153_100 };
      yield { type: 'message', text: 'Done.' };
    });
    const session = sessionWith(provider);

    const events = await collectTurn(session, 'fix it');

    expect(response(events)).toMatchObject({ inputTokens: 3_000, cacheReadTokens: 301_000, contextTokens: 153_100 });
  });

  it('takes the prompt of the last call when the agent reports usage per call and no context', async () => {
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'usage', usage: { inputTokens: 1_000, outputTokens: 50, cacheReadTokens: 150_000 } };
      yield { type: 'usage', usage: { inputTokens: 2_000, outputTokens: 80, cacheReadTokens: 151_000, cacheCreationTokens: 100 } };
      yield { type: 'message', text: 'Done.' };
    });
    const session = sessionWith(provider);

    const events = await collectTurn(session, 'fix it');

    expect(response(events)).toMatchObject({ contextTokens: 153_100 });
  });
});

describe('the context window the agent reports', () => {
  const windowOf = (session: Session) =>
    session.getInfo().providers.find((p) => p.name === 'fake-agent')?.models.find((m) => m.id === 'fake-model')?.contextWindow;
  const windowsIn = (events: ReadonlyArray<MoxxyEvent>) =>
    events.filter((e) => e.type === 'plugin_event' && e.subtype === AGENT_CONTEXT_WINDOW_SUBTYPE);

  it('replaces the starting window in the session info, once per change', async () => {
    let tokens = 380_000;
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'context_window', model: 'fake-model', tokens };
      yield { type: 'message', text: 'Hi.' };
    });
    const session = sessionWith(provider);
    expect(windowOf(session)).toBe(200_000);

    const first = await collectTurn(session, 'hi');
    const same = await collectTurn(session, 'hi again');
    tokens = 400_000;
    const changed = await collectTurn(session, 'and again');

    expect(windowsIn(first)).toHaveLength(1);
    expect(windowsIn(same)).toEqual([]);
    expect(windowsIn(changed)).toHaveLength(1);
    expect(windowOf(session)).toBe(400_000);
  });

  it('ignores a window that is not a positive whole number', async () => {
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'context_window', model: 'fake-model', tokens: 0 };
      yield { type: 'message', text: 'Hi.' };
    });
    const session = sessionWith(provider);

    const events = await collectTurn(session, 'hi');

    expect(windowsIn(events)).toEqual([]);
    expect(windowOf(session)).toBe(200_000);
  });
});

describe('a turn the agent starts by itself', () => {
  it('opens a Moxxy turn marked as the agent continuing, which reads the agent turn and sends it nothing', async () => {
    const provider = new FakeAgentProvider(async function* (req) {
      yield { type: 'message', text: req.continuesAgentTurn ? 'The background task found two files.' : 'Started it in the background.' };
    });
    const session = sessionWith(provider);
    await collectTurn(session, 'Start a background task');

    provider.startAgentTurn(String(session.id), 'List files finished in the background');
    await vi.waitFor(() => expect(session.log.ofType('assistant_message')).toHaveLength(2));

    const prompts = session.log.ofType('user_prompt');
    expect(prompts.at(-1)).toMatchObject({ text: 'List files finished in the background', origin: { kind: 'agent', name: 'List files finished in the background' } });
    expect(provider.steps.at(-1)?.continuesAgentTurn).toBe(true);
    expect(provider.steps[0]?.continuesAgentTurn).toBeUndefined();
    expect(session.log.ofType('assistant_message').at(-1)).toMatchObject({ content: 'The background task found two files.', turnId: prompts.at(-1)?.turnId });
  });

  const agentsOwn = (name: string) => ({ origin: { kind: 'agent' as const, name } });
  const noReplies = (events: ReadonlyArray<MoxxyEvent>) => events.filter(isAgentNoReplyEvent);

  it('does not announce completion while the agent is still running', async () => {
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'usage', usage: { inputTokens: 900, outputTokens: 0 } };
      expect(noReplies(session.log.ofType('plugin_event'))).toEqual([]);
    });
    const session = sessionWith(provider);

    await collectTurn(session, 'Task finished', agentsOwn('Task finished'));

    expect(noReplies(session.log.ofType('plugin_event'))).toHaveLength(1);
  });

  it('does not call a turn empty when it ran a Moxxy tool without replying', async () => {
    let runs = 0;
    const provider = new FakeAgentProvider(async function* (request) {
      await request.host.runTool({ callId: 'read-status', name: 'status', input: {} });
      yield { type: 'usage', usage: { inputTokens: 900, outputTokens: 0 } };
    });
    const session = sessionWith(provider);
    session.tools.register(defineTool({
      name: 'status',
      description: 'Read the task status',
      inputSchema: z.object({}),
      handler: async () => { runs += 1; return 'finished'; },
    }));

    const events = await collectTurn(session, 'Task finished', agentsOwn('Task finished'));

    expect(runs).toBe(1);
    expect(noReplies(events)).toEqual([]);
  });

  it('does not announce an empty completion when the person stopped the turn', async () => {
    const controller = new AbortController();
    const provider = new FakeAgentProvider(async function* () {
      controller.abort();
      yield { type: 'usage', usage: { inputTokens: 900, outputTokens: 0 } };
    });
    const session = sessionWith(provider);

    const events = await collectTurn(session, 'Task finished', { ...agentsOwn('Task finished'), signal: controller.signal });

    expect(types(events)).toContain('abort');
    expect(noReplies(events)).toEqual([]);
  });

  it('records that the agent finished without replying when its turn said nothing and ran nothing', async () => {
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'reasoning', text: 'Nothing left to say.' };
      yield { type: 'usage', usage: { inputTokens: 900, outputTokens: 4 } };
    });
    const session = sessionWith(provider);

    const events = await collectTurn(session, 'List files finished in the background', agentsOwn('List files finished in the background'));

    const notes = noReplies(events);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ pluginId: AGENT_CONNECTION_PLUGIN_ID, subtype: AGENT_NO_REPLY_SUBTYPE, turnId: events[0]?.turnId });
    expect(events.at(-1)).toBe(notes[0]);
  });

  it('records no such note when the agent replied, ran a tool or its helper answered', async () => {
    const turns: ReadonlyArray<ReadonlyArray<AgentStepEvent>> = [
      [{ type: 'message', text: 'The background task found two files.' }],
      [{ type: 'text_delta', delta: 'The task finished.' }],
      [
        { type: 'tool_call', callId: 'c1', name: 'Bash', input: { command: 'ls' } },
        { type: 'tool_result', callId: 'c1', ok: true, output: 'a b' },
      ],
      [
        { type: 'subagent_started', id: 'sub-1', label: 'List files', agentType: 'Explore' },
        { type: 'subagent_completed', id: 'sub-1', text: 'Two files.' },
      ],
    ];
    for (const turn of turns) {
      const provider = new FakeAgentProvider(async function* () {
        yield* turn;
      });
      const session = sessionWith(provider);

      const events = await collectTurn(session, 'Task finished', agentsOwn('Task finished'));

      expect(noReplies(events)).toEqual([]);
    }
  });

  it('records no such note when the agent turn ended on an error or a used-up limit, which say why themselves', async () => {
    const turns: ReadonlyArray<ReadonlyArray<AgentStepEvent>> = [
      [{ type: 'error', message: 'codex exited with code 1', retryable: false }],
      [{ type: 'account_limit', limit: { state: 'reached', resetsAt: Date.now() + 60_000 } }, { type: 'error', message: 'usage limit', retryable: false }],
      [{ type: 'account_limit', limit: { state: 'reached', resetsAt: Date.now() + 60_000 } }],
    ];
    for (const turn of turns) {
      const provider = new FakeAgentProvider(async function* () {
        yield* turn;
      });
      const session = sessionWith(provider);

      const events = await collectTurn(session, 'Task finished', agentsOwn('Task finished'));

      expect(noReplies(events)).toEqual([]);
    }
  });

  it('records no such note in a turn the person started, where an empty reply is the agent answer', async () => {
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'usage', usage: { inputTokens: 900, outputTokens: 0 } };
    });
    const session = sessionWith(provider);

    const events = await collectTurn(session, 'hi');

    expect(noReplies(events)).toEqual([]);
  });

  it('marks the turn with the background work whose end the agent took up, so the chat can open that work', async () => {
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'message', text: 'It finished.' };
    });
    const session = sessionWith(provider);

    provider.startAgentTurn(String(session.id), 'npm test finished in the background', 'task-7');
    await vi.waitFor(() => expect(session.log.ofType('assistant_message')).toHaveLength(1));

    expect(session.log.ofType('user_prompt').at(-1)?.origin).toEqual({ kind: 'agent', name: 'npm test finished in the background', workId: 'task-7' });
  });

  it('ignores a turn the agent started in another conversation', async () => {
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'message', text: 'ok' };
    });
    const session = sessionWith(provider);

    provider.startAgentTurn('another-conversation', 'Something finished');
    await new Promise((resolve) => setImmediate(resolve));

    expect(session.log.ofType('user_prompt')).toHaveLength(0);
    expect(provider.steps).toHaveLength(0);
  });
});

describe("the agent's work in the background", () => {
  it('is recorded the moment it happens, with no turn running, so every surface shows it live', async () => {
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'subagent_started', id: 'sub-1', label: 'Inspect folder', agentType: 'Explore' };
      yield { type: 'message', text: 'A helper is on it.' };
    });
    const session = sessionWith(provider);
    await collectTurn(session, 'look around');

    provider.reportActivity(String(session.id), [
      { type: 'subagent_tool_call', id: 'sub-1', name: 'Read', input: { file_path: 'a.ts' } },
      { type: 'subagent_message', id: 'sub-1', text: 'a.ts exports one function.' },
      { type: 'background_work', work: [{ id: 'sub-1', kind: 'agent', label: 'Inspect folder' }] },
    ]);
    await vi.waitFor(() => expect(session.log.ofType('plugin_event').filter((e) => e.subtype === 'background_work')).toHaveLength(1));

    const later = session.log.ofType('plugin_event').filter((e) => ['subagent_tool_call', 'subagent_message', 'background_work'].includes(e.subtype));
    expect(later.map((e) => [e.subtype, e.payload])).toEqual([
      ['subagent_tool_call', { childSessionId: 'sub-1', name: 'Read', input: { file_path: 'a.ts' } }],
      ['subagent_message', { childSessionId: 'sub-1', text: 'a.ts exports one function.' }],
      ['background_work', { provider: provider.name, work: [{ id: 'sub-1', kind: 'agent', label: 'Inspect folder' }] }],
    ]);
    expect(session.log.ofType('user_prompt')).toHaveLength(1);
  });

  it('is listed in the session info while it runs, and every client hears when that changes', async () => {
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'message', text: 'ok' };
    });
    const session = sessionWith(provider);
    const heard: Array<ReadonlyArray<unknown> | undefined> = [];
    session.onInfoChanged((info) => heard.push(info.backgroundWork));
    const server = { id: 'b1', kind: 'command' as const, label: 'npm run dev' };

    provider.reportActivity(String(session.id), [{ type: 'background_work', work: [server] }]);
    await vi.waitFor(() => expect(session.getInfo().backgroundWork).toEqual([server]));
    provider.reportActivity(String(session.id), [{ type: 'background_work', work: [] }]);
    await vi.waitFor(() => expect(session.getInfo().backgroundWork).toEqual([]));

    expect(heard).toEqual([[server], []]);
  });

  it("leaves another conversation's background work out", async () => {
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'message', text: 'ok' };
    });
    const session = sessionWith(provider);

    provider.reportActivity('another-conversation', [{ type: 'background_work', work: [{ id: 'b1', kind: 'command', label: 'sleep 60' }] }]);
    await new Promise((resolve) => setImmediate(resolve));

    expect(session.log.ofType('plugin_event')).toEqual([]);
  });

  it('is stopped one work at a time by the agent that runs it', async () => {
    const provider = new FakeAgentProvider(async function* () {
      yield { type: 'message', text: 'ok' };
    });
    provider.running.add('b1');
    const session = sessionWith(provider);

    expect(await session.stopBackgroundWork('b1')).toBe(true);
    expect(await session.stopBackgroundWork('b1')).toBe(false);
    expect(provider.stopped).toEqual([{ sessionId: String(session.id), workId: 'b1' }, { sessionId: String(session.id), workId: 'b1' }]);
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
