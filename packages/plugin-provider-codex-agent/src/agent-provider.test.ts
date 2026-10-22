/**
 * The Codex agent connection, end to end: a real Moxxy session and loop drive
 * `agentStep`, and Codex itself is the stand-in at the `codex app-server`
 * boundary (fake-codex.testkit.ts). Nothing between them is replaced.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  AGENT_GOAL_SUBTYPE,
  QUESTION_ASKED,
  autoApproveFromEvents,
  definePlugin,
  defineProvider,
  defineTool,
  type MoxxyEvent,
  type PermissionResolver,
  type QuestionItem,
  type Skill,
  type ToolDef,
} from '@moxxy/sdk';
import { buildSynthesizeSkillPlugin, collectTurn, type Session } from '@moxxy/core';
import { FakeProvider, addFakeProvider, createFakeSession, textReply } from '@moxxy/testing';
import { defaultModePlugin } from '@moxxy/mode-default';
import { planModePlugin } from '@moxxy/mode-plan';
import { goalModePlugin } from '@moxxy/mode-goal';
import { AgentSessionPool } from '@moxxy/agent-connection-kit';
import { CODEX_AGENT_DEFAULT_MODEL, CodexAgentProvider, codexAgentModels } from './agent-provider.js';
import { toolsLentToCodex, type CodexAgentSession } from './codex-session.js';
import { FakeCodex, type CodexScene, type FakeCodexDefaults } from './fake-codex.testkit.js';

const sessions: Session[] = [];
const pools: AgentSessionPool<CodexAgentSession>[] = [];
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.closeAll()));
  await Promise.all(sessions.splice(0).map((session) => session.close()));
});

function connect(scene: CodexScene, defaults: FakeCodexDefaults = {}) {
  const codex = new FakeCodex(scene, defaults);
  const pool = new AgentSessionPool<CodexAgentSession>({ limit: 4 });
  pools.push(pool);
  const provider = new CodexAgentProvider({ startAppServer: codex.start, sessions: pool });
  const session = createFakeSession({ provider, cwd: '/work/app' });
  sessions.push(session);
  session.pluginHost.registerStatic(defaultModePlugin);
  return { codex, session, provider, pool };
}

const said = (events: ReadonlyArray<MoxxyEvent>) =>
  events.flatMap((e) => (e.type === 'assistant_message' && e.source === 'model' ? [e.content] : []));
const autoApproveOf = (session: Session) => autoApproveFromEvents(session.log.ofType('plugin_event'));
const denyAll: PermissionResolver = { name: 'deny-all', check: async () => ({ mode: 'deny', reason: 'the person said no' }) };
const allowAll: PermissionResolver = { name: 'allow-all', check: async () => ({ mode: 'allow' }) };
const ASKING = { approvalPolicy: 'on-request', sandbox: { type: 'readOnly', networkAccess: false } } as const;
/**
 * Moxxy's asking on a Codex set up never to ask: Codex holds each command and edit for the person,
 * whatever the model decides. The sandbox lets the workspace be edited, so the model, told only
 * what it may read, does not decline a change before Codex can ask.
 */
const MOXXY_ASKING = {
  approvalPolicy: 'untrusted',
  sandbox: { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false },
} as const;

describe('a turn on the Codex agent connection', () => {
  it("starts Codex in the conversation folder with only Moxxy's MCP server and Codex's checklist added, and shows what Codex did", async () => {
    const { codex, session } = connect(async (turn) => {
      await turn.run('echo spike-ok', 'spike-ok\n');
      turn.usage(1200, 40, 1000);
      turn.say(`You said: ${turn.text}`);
    });

    const events = await collectTurn(session, 'Run echo spike-ok');

    const server = codex.last;
    expect(server.sent('initialize')[0]).toMatchObject({ clientInfo: { name: 'moxxy' }, capabilities: { experimentalApi: true } });
    expect(server.notifications).toContain('thread/started');
    const [start] = server.sent('thread/start');
    // Codex runs as the person set it up: no instructions, policy or sandbox of Moxxy's, on the
    // model the person picked in Moxxy. Its checklist tool, off by default since Codex 0.152, is on
    // so the step list shows.
    expect(Object.keys(start ?? {}).sort()).toEqual(['config', 'cwd', 'model']);
    expect(start).toMatchObject({ cwd: '/work/app', model: codexAgentModels[0]?.id, config: { mcp_servers: { moxxy: { url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/) } }, 'tools.update_plan.enabled': true } });
    expect(server.sent('turn/start')[0]).toMatchObject({ threadId: 'thread-1', input: [{ type: 'text', text: 'Run echo spike-ok', text_elements: [] }] });
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_call_requested', name: 'Bash', input: { command: 'echo spike-ok', cwd: '/work/app' }, executedBy: 'provider' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_result', ok: true, output: 'spike-ok\n' }));
    expect(said(events)).toEqual(['You said: Run echo spike-ok']);
    expect(events).toContainEqual(expect.objectContaining({ type: 'provider_response', inputTokens: 200, outputTokens: 40, cacheReadTokens: 1000 }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'plugin_event', subtype: 'agent_session', payload: expect.objectContaining({ sessionId: 'thread-1' }) }));
  });

  it("leaves Codex's checklist as the person set it in their Codex config", async () => {
    const { codex, session } = connect(async (turn) => turn.say('ok'), { planTool: false });

    await collectTurn(session, 'hi');

    const [start] = codex.last.sent('thread/start');
    expect(start).toMatchObject({ config: { mcp_servers: { moxxy: expect.anything() } } });
    expect(start ? Object.keys(start.config as object) : []).toEqual(['mcp_servers']);
  });

  it("records Codex's checklist as a step list each time Codex changes it", async () => {
    const { session } = connect(async (turn) => {
      turn.server.notify('turn/plan/updated', { threadId: turn.threadId, turnId: turn.id, explanation: null, plan: [{ step: 'Create a.txt', status: 'inProgress' }] });
      turn.server.notify('turn/plan/updated', { threadId: turn.threadId, turnId: turn.id, explanation: null, plan: [{ step: 'Create a.txt', status: 'completed' }] });
      turn.say('done');
    });

    const events = await collectTurn(session, 'make a.txt');

    const lists = events.flatMap((e) => (e.type === 'tool_result' && e.ok ? [(e.output as { display?: { steps?: unknown } }).display?.steps] : []));
    expect(lists).toEqual([[{ text: 'Create a.txt', status: 'in_progress' }], [{ text: 'Create a.txt', status: 'completed' }]]);
    expect(events.filter((e) => e.type === 'tool_call_requested').map((e) => e.type === 'tool_call_requested' && e.name)).toEqual(['update_plan', 'update_plan']);
  });

  it("keeps the turn going while a subagent's own thread starts and finishes a turn", async () => {
    const { session } = connect(async (turn) => {
      const child = { threadId: 'thread-child', turn: { id: 'turn-child', items: [], status: 'inProgress', error: null } };
      turn.server.notify('turn/started', child);
      turn.server.notify('turn/completed', { ...child, turn: { ...child.turn, status: 'completed' } });
      await turn.run('echo after', 'after\n');
      turn.say('The subagent found two files.');
    });

    const events = await collectTurn(session, 'ask a subagent');

    expect(said(events)).toEqual(['The subagent found two files.']);
  });

  it("shows a subagent Codex starts as a subagent, with the tools it runs in its own thread and its answer", async () => {
    const { session } = connect(async (turn) => {
      const activity = (kind: string) => ({ threadId: turn.threadId, turnId: turn.id, item: { type: 'subAgentActivity', id: `act-${kind}`, kind, agentThreadId: 'thread-child', agentPath: '/root/inspect_folder' } });
      const child = { threadId: 'thread-child', turnId: 'turn-child' };
      turn.server.notify('item/started', activity('started'));
      turn.server.notify('item/completed', { ...child, item: { type: 'commandExecution', id: 'exec-c', command: 'ls', cwd: '/work/app', status: 'completed', aggregatedOutput: 'a.txt', exitCode: 0 } });
      turn.server.notify('item/completed', { ...child, item: { type: 'agentMessage', id: 'msg-c', text: 'One file: a.txt.', phase: 'final_answer' } });
      turn.server.notify('item/started', activity('completed'));
      turn.say('The subagent found a.txt.');
    });

    const events = await collectTurn(session, 'ask a subagent');

    const subagents = events.flatMap((e) => (e.type === 'plugin_event' && e.pluginId === '@moxxy/subagents' ? [[e.subtype, e.payload]] : []));
    expect(subagents).toEqual([
      ['subagent_started', expect.objectContaining({ childSessionId: 'thread-child', label: 'inspect folder' })],
      ['subagent_tool_call', expect.objectContaining({ childSessionId: 'thread-child', name: 'Bash', input: { command: 'ls', cwd: '/work/app' } })],
      ['subagent_completed', expect.objectContaining({ childSessionId: 'thread-child', text: 'One file: a.txt.' })],
    ]);
    expect(events.filter((e) => e.type === 'tool_call_requested')).toEqual([]);
    expect(said(events)).toEqual(['The subagent found a.txt.']);
  });

  it('opens the thread on the model the person picked, so Codex never switches models before the first turn', async () => {
    // A thread opened on the config's model and switched before the turn carries Codex's
    // model-switch instructions in every later request.
    const { codex, session } = connect(async (turn) => turn.say(turn.thread.model), { model: 'gpt-6.1-sol' });

    const events = await collectTurn(session, 'which model?');

    expect(codex.last.sent('thread/start')[0]).toMatchObject({ model: codexAgentModels[0]?.id });
    expect(codex.last.sent('thread/settings/update').some((update) => 'model' in update)).toBe(false);
    expect(said(events)).toEqual([codexAgentModels[0]?.id]);
  });

  it('switches the thread to another model the person picks later in the conversation', async () => {
    const { codex, session } = connect(async (turn) => turn.say(turn.thread.model));
    const other = codexAgentModels[1]?.id;

    await collectTurn(session, 'first');
    const events = await collectTurn(session, 'second', { model: other });

    expect(codex.last.sent('thread/settings/update').filter((update) => 'model' in update)).toEqual([expect.objectContaining({ model: other })]);
    expect(said(events)).toEqual([other]);
  });

  it('runs Codex on its fast tier while fast mode is on, and on its own tier again when it is off', async () => {
    // Codex names its standard tier `default`.
    const { codex, session } = connect(async (turn) => turn.say(turn.thread.serviceTier ?? 'default'), { serviceTier: 'default' });

    session.fast = true;
    const fast = await collectTurn(session, 'quick');
    session.fast = false;
    const normal = await collectTurn(session, 'slow');

    const updates = codex.last.sent('thread/settings/update');
    expect(updates[0]).toMatchObject({ serviceTier: 'priority' });
    expect(updates[1]).toMatchObject({ serviceTier: null });
    expect(updates).toHaveLength(2);
    expect([...said(fast), ...said(normal)]).toEqual(['priority', 'default']);
  });

  it('leaves a Codex set up for its fast tier on it', async () => {
    const { codex, session } = connect(async (turn) => turn.say(turn.thread.serviceTier ?? 'standard'), { serviceTier: 'priority' });

    const events = await collectTurn(session, 'quick');

    expect(codex.last.sent('thread/settings/update')[0]).not.toHaveProperty('serviceTier');
    expect(said(events)).toEqual(['priority']);
  });

  it('keeps the same thread for the next message of the conversation', async () => {
    const { codex, session } = connect(async (turn) => turn.say(turn.text === 'first' ? 'one' : 'two'));

    await collectTurn(session, 'first');
    const second = await collectTurn(session, 'second');

    expect(codex.servers).toHaveLength(1);
    expect(codex.last.sent('thread/start')).toHaveLength(1);
    expect(codex.last.sent('turn/start')).toHaveLength(2);
    expect(said(second)).toEqual(['two']);
  });

  it('resumes the thread in a new Codex when the old one was closed and the conversation goes on', async () => {
    const { codex, session, pool } = connect(async (turn) => turn.say('ok'));
    await collectTurn(session, 'remember MARMOT-55');
    await pool.close(String(session.id));

    await collectTurn(session, 'which word?');

    expect(codex.servers).toHaveLength(2);
    expect(codex.servers[0]?.closed).toBe(true);
    expect(codex.last.sent('thread/resume')[0]).toMatchObject({ threadId: 'thread-1', cwd: '/work/app', model: codexAgentModels[0]?.id });
    expect(codex.last.sent('thread/start')).toHaveLength(0);
  });

  it('starts a new thread when Codex no longer has the old one', async () => {
    const { codex, session, pool } = connect(async (turn) => turn.say('ok'));
    await collectTurn(session, 'hello');
    await pool.close(String(session.id));
    codex.saved.clear();

    const events = await collectTurn(session, 'hello again');

    expect(codex.last.sent('thread/start')).toHaveLength(1);
    expect(events).toContainEqual(expect.objectContaining({ subtype: 'agent_session', payload: expect.objectContaining({ sessionId: 'thread-2' }) }));
  });

  it('hears, when the person comes back to it, what the conversation did on another connection meanwhile', async () => {
    const { codex, session, provider } = connect(async (turn) => turn.say('ok'));
    addFakeProvider(session, new FakeProvider({ name: 'stand-in', script: [textReply('Renamed it to orders.')] }));

    await collectTurn(session, 'use port 5433');
    session.providers.setActive('stand-in');
    await collectTurn(session, 'rename the table to orders');
    session.providers.setActive(provider.name);
    await collectTurn(session, 'what did you rename?');
    await collectTurn(session, 'thanks');

    expect(codex.last.sent('thread/start')).toHaveLength(1);
    const [, back, after] = codex.last.sent('turn/start');
    const [note, prompt] = (back?.input ?? []) as Array<{ text: string }>;
    expect(note?.text).toMatch(/another connection/);
    expect(note?.text).toContain('### Turn 2\nPerson: rename the table to orders\nAgent: Renamed it to orders.');
    expect(note?.text).not.toContain('use port 5433');
    expect(prompt?.text).toBe('what did you rename?');
    expect(after?.input).toEqual([{ type: 'text', text: 'thanks', text_elements: [] }]);
  });

  it('hands a new thread the conversation so far when the earlier one is gone, once', async () => {
    const { codex, session, pool } = connect(async (turn) => turn.say('port 5433 it is'));
    await collectTurn(session, 'use port 5433');
    await pool.close(String(session.id));
    codex.saved.clear();

    await collectTurn(session, 'which port?');
    await collectTurn(session, 'thanks');

    const [first, second] = codex.last.sent('turn/start');
    const [note, prompt] = (first?.input ?? []) as Array<{ text: string }>;
    expect(note?.text).toMatch(/^Your earlier session for this Moxxy conversation no longer exists/);
    expect(note?.text).toContain('### Turn 1\nPerson: use port 5433\nAgent: port 5433 it is');
    expect(note?.text).not.toContain('which port?');
    expect(prompt?.text).toBe('which port?');
    expect(second?.input).toEqual([{ type: 'text', text: 'thanks', text_elements: [] }]);
  });

  it('says nothing more than the message to a new conversation', async () => {
    const { codex, session } = connect(async (turn) => turn.say('hi'));

    await collectTurn(session, 'hello');

    expect(codex.last.sent('turn/start')[0]?.input).toEqual([{ type: 'text', text: 'hello', text_elements: [] }]);
  });

  it('resumes the thread when Codex fails to read it once, instead of starting another', async () => {
    const { codex, session, pool } = connect(async (turn) => turn.say('ok'), { resumeFailures: 1 });
    await collectTurn(session, 'remember MARMOT-55');
    await pool.close(String(session.id));

    await collectTurn(session, 'which word?');

    expect(codex.last.sent('thread/resume')).toHaveLength(2);
    expect(codex.last.sent('thread/start')).toHaveLength(0);
  });

  it('starts no other thread when Codex keeps failing to read it, and says what happened', async () => {
    const { codex, session, pool } = connect(async (turn) => turn.say('ok'), { resumeFailures: 2 });
    await collectTurn(session, 'remember MARMOT-55');
    await pool.close(String(session.id));

    const events = await collectTurn(session, 'which word?');

    expect(codex.last.sent('thread/start')).toHaveLength(0);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'error', message: expect.stringContaining("Codex could not load this conversation's earlier session (failed to read the thread store)") }),
    );
  });

  it('hands an image of the person to Codex as an image', async () => {
    const { codex, session } = connect(async (turn) => turn.say(`${turn.input.length} parts`));

    await collectTurn(session, 'what colour?', {
      attachments: [{ kind: 'image', mediaType: 'image/png', content: 'iVBORw0KGgo=', name: 'shot.png' }],
    });

    expect(codex.last.sent('turn/start')[0]?.input).toEqual([
      { type: 'text', text: 'what colour?', text_elements: [] },
      { type: 'image', url: 'data:image/png;base64,iVBORw0KGgo=' },
    ]);
  });
});

describe('approvals: one state with Codex own policy', () => {
  it('shows auto-approve on when Codex runs with no approvals and full access', async () => {
    const { session } = connect(async (turn) => turn.say('ok'));

    await collectTurn(session, 'hi');

    expect(autoApproveOf(session)).toBe(true);
  });

  it("keeps auto-approve off the person chose before the first message, over Codex's own no-approvals policy", async () => {
    let decision: unknown;
    const { session } = connect(async (turn) => {
      decision = await turn.run('touch spike.txt', '', { approval: true });
      turn.say('done');
    });
    session.setPermissionResolver(denyAll);
    await session.setAutoApprove(true);
    await session.setAutoApprove(false);

    await collectTurn(session, 'create spike.txt');

    expect(autoApproveOf(session)).toBe(false);
    expect(decision).toEqual({ decision: 'decline' });
  });

  it('asks the person before a command Codex wants approved, and tells Codex the answer', async () => {
    let decision: unknown;
    const { session } = connect(
      async (turn) => {
        decision = await turn.run('touch spike.txt', '', { approval: true, reason: 'May I create spike.txt?' });
        turn.say('I could not create it.');
      },
      ASKING,
    );
    session.setPermissionResolver(denyAll);

    const events = await collectTurn(session, 'create spike.txt');

    expect(autoApproveOf(session)).toBe(false);
    expect(decision).toEqual({ decision: 'decline' });
    const call = events.find((e) => e.type === 'tool_call_requested' && e.name === 'Bash');
    if (call?.type !== 'tool_call_requested') throw new Error('expected the command to be shown');
    const order = events.filter((e) => 'callId' in e && e.callId === call.callId).map((e) => e.type);
    expect(order).toEqual(['tool_call_requested', 'tool_call_denied', 'tool_result']);
  });

  it("has the person answer, not Codex's own reviewer, while auto-approve is off", async () => {
    let decision: unknown;
    const { codex, session } = connect(
      async (turn) => {
        decision = await turn.run('touch spike.txt', '', { approval: true });
        turn.say('done');
      },
      { ...ASKING, approvalsReviewer: 'auto_review' },
    );
    session.setPermissionResolver(denyAll);

    await collectTurn(session, 'create spike.txt');

    expect(codex.last.sent('thread/settings/update')[0]).toMatchObject({ approvalsReviewer: 'user' });
    expect(decision).toEqual({ decision: 'decline' });
  });

  it("leaves Codex's own reviewer where Moxxy answers nothing itself", async () => {
    const { codex, session } = connect(async (turn) => turn.say('ok'), { approvalsReviewer: 'auto_review' });

    await collectTurn(session, 'hi');

    expect(autoApproveOf(session)).toBe(true);
    expect(codex.last.sent('thread/settings/update').some((update) => 'approvalsReviewer' in update)).toBe(false);
  });

  it("tells Codex in its running turn why the person declined, since Codex's answer carries no reason", async () => {
    const { codex, session } = connect(
      async (turn) => {
        await turn.run('touch app.js', '', { approval: true });
        turn.say(`Understood: ${await turn.steered()}`);
      },
      ASKING,
    );
    session.setPermissionResolver({ name: 'person', check: async () => ({ mode: 'deny', reason: 'not now, build it in goal mode' }) });

    const events = await collectTurn(session, 'build it');

    expect(codex.last.sent('turn/steer')[0]).toMatchObject({
      threadId: 'thread-1',
      expectedTurnId: 'turn-1',
      input: [{ type: 'text', text: expect.stringContaining('not now, build it in goal mode') }],
    });
    expect(said(events)[0]).toContain('Bash');
    expect(said(events)[0]).toContain('not now, build it in goal mode');
  });

  it('carries the reason into the next message when the turn can no longer take it', async () => {
    const { codex, session } = connect(
      async (turn) => {
        if (turn.text === 'build it') await turn.run('touch app.js', '', { approval: true });
        turn.say('ok');
      },
      { ...ASKING, refuseSteer: true },
    );
    session.setPermissionResolver({ name: 'person', check: async () => ({ mode: 'deny', reason: 'not now' }) });

    await collectTurn(session, 'build it');
    await collectTurn(session, 'what next?');
    await collectTurn(session, 'and then?');

    const [, next, after] = codex.last.sent('turn/start');
    expect(next?.input).toEqual([
      { type: 'text', text: expect.stringContaining('not now'), text_elements: [] },
      { type: 'text', text: 'what next?', text_elements: [] },
    ]);
    expect(after?.input).toEqual([{ type: 'text', text: 'and then?', text_elements: [] }]);
  });

  it('lets Codex go ahead when the person allows', async () => {
    let decision: unknown;
    const { session } = connect(
      async (turn) => {
        decision = await turn.run('touch spike.txt', '', { approval: true });
        turn.say('Created.');
      },
      ASKING,
    );
    session.setPermissionResolver(allowAll);

    await collectTurn(session, 'create spike.txt');

    expect(decision).toEqual({ decision: 'accept' });
  });

  it('turning auto-approve off makes Codex ask, for this conversation only; on again restores how Codex was set up', async () => {
    const { codex, session } = connect(async (turn) => turn.say('ok'));
    await collectTurn(session, 'one');

    await session.setAutoApprove(false);
    await collectTurn(session, 'two');
    expect(codex.last.thread).toMatchObject(MOXXY_ASKING);

    await session.setAutoApprove(true);
    await collectTurn(session, 'three');
    expect(codex.last.thread).toMatchObject({ approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' } });
  });

  it('lets the model ask for each write on a Codex that no longer takes untrusted, rather than fail the turn', async () => {
    const { codex, session } = connect(async (turn) => turn.say('ok'), { refusedApprovalPolicies: ['untrusted'] });
    await collectTurn(session, 'one');
    await session.setAutoApprove(false);

    const events = await collectTurn(session, 'two');
    await collectTurn(session, 'three');

    expect(said(events)).toEqual(['ok']);
    expect(codex.last.thread).toMatchObject(ASKING);
  });

  it('shows auto-approve off when the thread starts asking without Moxxy changing it, and leaves Codex so', async () => {
    const { codex, session } = connect(async (turn) => turn.say('ok'));
    await collectTurn(session, 'one');
    expect(autoApproveOf(session)).toBe(true);

    codex.last.changeSettingsElsewhere(ASKING);
    await collectTurn(session, 'two');

    expect(autoApproveOf(session)).toBe(false);
    expect(codex.last.thread).toMatchObject(ASKING);
  });

  it('follows a change of the thread approvals in the middle of a turn, and says it came from outside Moxxy', async () => {
    const { codex, session } = connect(async (turn) => {
      if (turn.text === 'two') turn.server.changeSettingsElsewhere(ASKING);
      turn.say('ok');
    });
    await collectTurn(session, 'one');

    const events = await collectTurn(session, 'two');

    expect(events).toContainEqual(expect.objectContaining({ type: 'plugin_event', subtype: 'auto_approve', payload: { enabled: false, elsewhere: true } }));
    expect(autoApproveOf(session)).toBe(false);
    expect(codex.last.thread).toMatchObject(ASKING);
  });

  it('keeps a tighter way of asking set outside Moxxy rather than loosen it back on the next turn', async () => {
    const UNTRUSTED = { approvalPolicy: 'untrusted', sandbox: { type: 'readOnly', networkAccess: false } } as const;
    const { codex, session } = connect(async (turn) => turn.say('ok'));
    await collectTurn(session, 'one');

    codex.last.changeSettingsElsewhere(UNTRUSTED);
    await collectTurn(session, 'two');
    await collectTurn(session, 'three');

    expect(autoApproveOf(session)).toBe(false);
    expect(codex.last.thread).toMatchObject(UNTRUSTED);
  });

  it('sets the thread back to asking when something outside Moxxy lets Codex run without asking between turns', async () => {
    const { codex, session } = connect(async (turn) => turn.say('ok'));
    await collectTurn(session, 'one');
    await session.setAutoApprove(false);
    await collectTurn(session, 'two');

    codex.last.changeSettingsElsewhere({ approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' } });
    const events = await collectTurn(session, 'three');

    expect(autoApproveOf(session)).toBe(false);
    expect(codex.last.thread).toMatchObject(MOXXY_ASKING);
    expect(events).toContainEqual(expect.objectContaining({ type: 'plugin_event', subtype: 'auto_approve_restored' }));
  });

  it('sets the thread back to asking at once when it is loosened outside Moxxy in the middle of a turn', async () => {
    const { codex, session } = connect(async (turn) => {
      if (turn.text === 'three') turn.server.changeSettingsElsewhere({ approvalPolicy: 'never', sandbox: { type: 'workspaceWrite', writableRoots: [], networkAccess: false } });
      turn.say('ok');
    });
    await collectTurn(session, 'one');
    await session.setAutoApprove(false);
    await collectTurn(session, 'two');

    const events = await collectTurn(session, 'three');

    expect(autoApproveOf(session)).toBe(false);
    expect(codex.last.thread).toMatchObject(MOXXY_ASKING);
    expect(events.filter((e) => e.type === 'plugin_event' && e.subtype === 'auto_approve_restored')).toHaveLength(1);
  });

  it("gives the person's answers back when Codex's own reviewer is put in their place outside Moxxy", async () => {
    const { codex, session } = connect(async (turn) => turn.say('ok'));
    await collectTurn(session, 'one');
    await session.setAutoApprove(false);
    await collectTurn(session, 'two');

    codex.last.changeSettingsElsewhere({ approvalsReviewer: 'auto_review' });
    await collectTurn(session, 'three');

    expect(codex.last.thread).toMatchObject({ ...MOXXY_ASKING, approvalsReviewer: 'user' });
  });

  it('keeps plan mode read-only when something outside Moxxy gives Codex full access during it', async () => {
    const { codex, session } = connect(async (turn) => {
      turn.server.changeSettingsElsewhere({ approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' } });
      turn.say('plan');
    });
    session.pluginHost.registerStatic(planModePlugin);
    session.modes.setActive('plan');

    await collectTurn(session, 'plan it');

    expect(codex.last.thread).toMatchObject({ approvalPolicy: 'never', sandbox: { type: 'readOnly' } });
  });

  it("does not take Moxxy's own changes, nor plan mode's read-only, for a change of auto-approve", async () => {
    const { session } = connect(async (turn) => turn.say('ok'));
    session.pluginHost.registerStatic(planModePlugin);
    await collectTurn(session, 'one');
    await session.setAutoApprove(false);
    await collectTurn(session, 'two');
    await session.setAutoApprove(true);
    session.modes.setActive('plan');

    await collectTurn(session, 'plan it');

    expect(autoApproveOf(session)).toBe(true);
  });

  it('keeps auto-approve the person turned on when a new Codex resumes the thread', async () => {
    const { codex, session, pool } = connect(async (turn) => turn.say('ok'), ASKING);
    await collectTurn(session, 'one');
    await session.setAutoApprove(true);
    await collectTurn(session, 'two');
    await pool.close(String(session.id));

    await collectTurn(session, 'three');

    expect(codex.last.sent('thread/resume')).toHaveLength(1);
    expect(autoApproveOf(session)).toBe(true);
    expect(codex.last.thread).toMatchObject({ approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' } });
  });

  it('keeps auto-approve the person turned off when a new Codex resumes the thread', async () => {
    const { codex, session, pool } = connect(async (turn) => turn.say('ok'));
    await collectTurn(session, 'one');
    await session.setAutoApprove(false);
    await collectTurn(session, 'two');
    await pool.close(String(session.id));

    await collectTurn(session, 'three');

    expect(codex.last.sent('thread/resume')).toHaveLength(1);
    expect(autoApproveOf(session)).toBe(false);
    expect(codex.last.thread).toMatchObject(MOXXY_ASKING);
  });

  it("gives Codex its own reviewer back after a new Codex resumed a thread Moxxy had set to the person's answers", async () => {
    const { codex, session, pool } = connect(async (turn) => turn.say('ok'), { approvalsReviewer: 'auto_review' });
    await collectTurn(session, 'one');
    await session.setAutoApprove(false);
    await collectTurn(session, 'two');
    await pool.close(String(session.id));
    await collectTurn(session, 'three');

    await session.setAutoApprove(true);
    await collectTurn(session, 'four');

    expect(codex.last.thread).toMatchObject({ approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' }, approvalsReviewer: 'auto_review' });
  });

  it('lends Moxxy tools over MCP, run through Moxxy permissions and shown once', async () => {
    let ran = 0;
    const browserOpen = defineTool({
      name: 'browser_open',
      description: 'Open a page in the visible browser.',
      inputSchema: z.object({ url: z.string() }),
      handler: async ({ url }) => {
        ran += 1;
        return `opened ${url}`;
      },
    });
    let lent: unknown;
    const { session } = connect(async (turn) => {
      lent = await turn.callMoxxyTool('browser_open', { url: 'http://localhost:8765' });
      turn.completed({ type: 'mcpToolCall', id: 'mcp-1', server: 'moxxy', tool: 'browser_open', status: 'completed', arguments: {}, result: {}, error: null });
      turn.say('Opened.');
    });
    session.pluginHost.registerStatic(definePlugin({ name: 'test-browser', tools: [browserOpen] }));

    const events = await collectTurn(session, 'open the app');

    expect(ran).toBe(1);
    expect(lent).toMatchObject({ content: [{ type: 'text', text: 'opened http://localhost:8765' }] });
    expect(events.filter((e) => e.type === 'tool_call_requested').map((e) => (e as { name: string }).name)).toEqual(['browser_open']);
  });

  it('lists the Moxxy tools as Codex opens or resumes the thread, the only time Codex reads them', async () => {
    const recallLike = defineTool({ name: 'note_lookup', description: 'Look a note up.', inputSchema: z.object({}), handler: async () => 'the note' });
    const found: unknown[] = [];
    const { session, pool } = connect(async (turn) => {
      found.push(await turn.callMoxxyTool('note_lookup', {}));
      turn.say('ok');
    });
    session.pluginHost.registerStatic(definePlugin({ name: 'test-notes', tools: [recallLike] }));

    await collectTurn(session, 'look it up');
    await pool.close(String(session.id));
    await collectTurn(session, 'again, after a restart');

    expect(found).toEqual([
      expect.objectContaining({ content: [{ type: 'text', text: 'the note' }] }),
      expect.objectContaining({ content: [{ type: 'text', text: 'the note' }] }),
    ]);
  });
});

describe('the Moxxy tools Codex can see', () => {
  const askLike = defineTool({ name: 'ask_like', description: 'Ask the person.', inputSchema: z.object({}), notInModes: ['goal'], handler: async () => 'answered' });

  it('lists every Moxxy tool from the start, and says why one is not available in this mode', async () => {
    const results: Array<{ content: unknown; isError?: boolean }> = [];
    const { session } = connect(async (turn) => {
      results.push(await turn.callMoxxyTool('ask_like', {}));
      if (turn.objective !== undefined) turn.goal('complete');
      turn.say('ok');
    });
    session.pluginHost.registerStatic(definePlugin({ name: 'test-ask', tools: [askLike] }));
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive('goal');

    await collectTurn(session, 'do it');
    session.modes.setActive('default');
    await collectTurn(session, 'now ask me');

    expect(results[0]).toEqual({ content: [{ type: 'text', text: expect.stringMatching(/^ask_like is not available in goal mode/) }], isError: true });
    expect(results[1]).toEqual({ content: [{ type: 'text', text: 'answered' }] });
  });

  it("shows them to the model upfront, not behind Codex's tool search where it never looks for them", async () => {
    const { codex, session } = connect(async (turn) => turn.say('ok'));

    await collectTurn(session, 'hi');

    expect(codex.last.sent('thread/start')[0]).toMatchObject({ config: { mcp_servers: { moxxy: { omit_tools_from: ['deferred'] } } } });
  });

  it('lends them as a catalog of three small tools, so their full descriptions are not in every request, and the chat shows the tool that ran', async () => {
    const noted = defineTool({ name: 'note_lookup', description: 'Look a note up.', inputSchema: z.object({}), handler: async () => 'the note' });
    let read: ReadonlyArray<string> = [];
    const results: unknown[] = [];
    const { session } = connect(async (turn) => {
      read = turn.thread.moxxyTools;
      results.push(await turn.callMoxxyTool('note_lookup', {}));
      turn.say('ok');
    });
    session.pluginHost.registerStatic(definePlugin({ name: 'test-notes', tools: [noted] }));

    const events = await collectTurn(session, 'look it up');

    expect(read.filter((name) => name !== 'load_skill')).toEqual(['find_tools', 'describe_tools', 'call_tool']);
    expect(results).toEqual([{ content: [{ type: 'text', text: 'the note' }] }]);
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_call_requested', name: 'note_lookup' }));
    expect(events.some((e) => e.type === 'tool_call_requested' && e.name === 'call_tool')).toBe(false);
  });

  it('resumes the thread in a new Codex when the conversation gains a tool, so Codex reads the new list', async () => {
    const noted = defineTool({ name: 'note_lookup', description: 'Look a note up.', inputSchema: z.object({}), handler: async () => 'the note' });
    const found: unknown[] = [];
    const { codex, session } = connect(async (turn) => {
      if (turn.text === 'look it up') found.push(await turn.callMoxxyTool('note_lookup', {}));
      turn.say('ok');
    });
    await collectTurn(session, 'hello');
    const first = codex.last;
    session.pluginHost.registerStatic(definePlugin({ name: 'test-notes', tools: [noted] }));

    await collectTurn(session, 'look it up');

    expect(codex.last).not.toBe(first);
    expect(codex.last.sent('thread/resume')[0]).toMatchObject({ threadId: 'thread-1' });
    expect(found).toEqual([expect.objectContaining({ content: [{ type: 'text', text: 'the note' }] })]);
  });
});

describe("the person's Moxxy skills on Codex", () => {
  const skill = (name: string): Skill => ({
    id: name as Skill['id'],
    path: `/skills/${name}.md`,
    scope: 'project',
    frontmatter: { name, description: `About ${name}` },
    body: `Steps for ${name}.`,
  });

  function withSkills(scene: CodexScene, defaults: FakeCodexDefaults = {}) {
    const connected = connect(scene, defaults);
    connected.session.pluginHost.registerStatic(buildSynthesizeSkillPlugin(connected.session));
    connected.session.setPermissionResolver(allowAll);
    return connected;
  }

  it("lets Codex read one, leaving a skill Codex has itself to Codex's", async () => {
    const read: Array<{ content: unknown; isError?: boolean }> = [];
    const { session } = withSkills(
      async (turn) => {
        read.push(await turn.callMoxxyTool('load_skill', { name: 'monthly-invoices' }));
        read.push(await turn.callMoxxyTool('load_skill', { name: 'deploy-staging' }));
        turn.say('ok');
      },
      { ownSkills: ['deploy-staging'] },
    );
    session.skills.register(skill('monthly-invoices'));
    session.skills.register(skill('deploy-staging'));

    const events = await collectTurn(session, 'do the invoices');

    expect(read[0]).toEqual({ content: [{ type: 'text', text: expect.stringContaining('Steps for monthly-invoices.') }] });
    expect(read[1]).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('No Moxxy skill is named "deploy-staging"') }] });
    expect(events).toContainEqual(expect.objectContaining({ type: 'skill_invoked', name: 'monthly-invoices' }));
  });

  it('resumes the thread in a new Codex when a skill is saved, so Codex reads it at the next turn', async () => {
    const read: Array<{ content: unknown; isError?: boolean }> = [];
    const { codex, session } = withSkills(async (turn) => {
      if (turn.text === 'use it') read.push(await turn.callMoxxyTool('load_skill', { name: 'monthly-invoices' }));
      turn.say('ok');
    });
    await collectTurn(session, 'hello');
    const first = codex.last;
    session.skills.register(skill('monthly-invoices'));

    await collectTurn(session, 'use it');

    expect(codex.last).not.toBe(first);
    expect(codex.last.sent('thread/resume')[0]).toMatchObject({ threadId: 'thread-1' });
    expect(read).toEqual([{ content: [{ type: 'text', text: expect.stringContaining('Steps for monthly-invoices.') }] }]);
  });
});

describe('reasoning summaries', () => {
  it("asks for Codex's summaries of its thinking when the person's config leaves them to the model", async () => {
    const { codex, session } = connect(async (turn) => turn.say('ok'));

    await collectTurn(session, 'hi');

    expect(codex.last.sent('config/read')[0]).toMatchObject({ cwd: '/work/app' });
    expect(codex.last.sent('thread/settings/update')[0]).toMatchObject({ summary: 'auto' });
  });

  it('keeps the summaries the person set in their Codex config', async () => {
    const { codex, session } = connect(async (turn) => turn.say('ok'), { reasoningSummary: 'none' });

    await collectTurn(session, 'hi');
    await collectTurn(session, 'again');

    expect(codex.last.sent('thread/settings/update').some((update) => 'summary' in update)).toBe(false);
  });
});

describe('plan mode', () => {
  it('plans in Codex own plan mode, read-only, and shows its plan in the Moxxy plan card', async () => {
    const plan = '# Fix add\n\n## Summary\n\nUse a + b.\n';
    const { codex, session } = connect(async (turn) => {
      if (turn.thread.collaborationMode === 'plan') turn.completed({ type: 'plan', id: `${turn.id}-plan`, text: plan });
      else turn.say('Implemented.');
    });
    session.pluginHost.registerStatic(planModePlugin);
    session.modes.setActive('plan');

    const events = await collectTurn(session, 'plan the fix');

    expect(codex.last.sent('thread/settings/update')[0]).toMatchObject({
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
      collaborationMode: { mode: 'plan', settings: { model: codexAgentModels[0]?.id, developer_instructions: null } },
    });
    expect(events).toContainEqual(expect.objectContaining({ type: 'plugin_event', subtype: 'plan_completed', payload: { title: 'Fix add', questions: 0 } }));
    expect(events.filter((e) => e.type === 'assistant_message').at(-1)).toMatchObject({ source: 'system', content: plan });

    session.modes.setActive('default');
    const next = await collectTurn(session, 'Implement the approved plan above.');
    expect(codex.last.thread).toMatchObject({ collaborationMode: 'default', approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' } });
    expect(said(next)).toEqual(['Implemented.']);
  });

  it('shows Codex questions in the Moxxy question card and sends the answers as the next message', async () => {
    const { codex, session } = connect(async (turn) => {
      if (turn.text === 'plan the button') {
        turn.say('Which colour should the button be?\n- Red\n- Blue', {
          delivery: 'async',
          questions: [{ title: 'Which colour should the button be?', options: ['Red', 'Blue'] }, { title: 'What label?', options: null }],
        });
        return;
      }
      turn.completed({ type: 'plan', id: `${turn.id}-plan`, text: `# Button\n\n${turn.text}` });
    });
    session.pluginHost.registerStatic(planModePlugin);
    session.modes.setActive('plan');
    session.questions.attachSurface();
    let asked: ReadonlyArray<QuestionItem> = [];
    session.log.subscribe((event) => {
      if (event.type !== 'plugin_event' || event.subtype !== QUESTION_ASKED) return;
      const { questionId, questions } = event.payload as { questionId: string; questions: ReadonlyArray<QuestionItem> };
      asked = questions;
      const red = questions[0]?.options.find((o) => o.label === 'Red');
      void session.questions.answer(questionId, {
        [questions[0]?.id ?? '']: { selected: red ? [red.id] : [] },
        [questions[1]?.id ?? '']: { selected: [], other: 'Draw one' },
      });
    });

    const events = await collectTurn(session, 'plan the button');

    expect(asked.map((q) => [q.question, q.options.map((o) => o.label), q.allowOther])).toEqual([
      ['Which colour should the button be?', ['Red', 'Blue'], true],
      ['What label?', [], true],
    ]);
    expect(codex.last.sent('turn/start')[1]?.input).toEqual([
      { type: 'text', text: 'Which colour should the button be?: Red\nWhat label?: Draw one', text_elements: [] },
    ]);
    expect(events).toContainEqual(expect.objectContaining({ type: 'plugin_event', subtype: 'plan_completed' }));
  });
});

describe('goal mode', () => {
  it('runs a goal with Codex own goal, through its own turns, and ends Moxxy goal mode when Codex says it is met', async () => {
    let turns = 0;
    const { codex, session } = connect(async (turn) => {
      turns += 1;
      if (turns === 1) {
        turn.say('Writing goal.txt.');
        return;
      }
      await turn.run('cat goal.txt', 'GOAL-DONE\n');
      turn.goal('complete');
      turn.say('goal.txt says GOAL-DONE.');
    });
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive('goal');

    const events = await collectTurn(session, 'goal.txt says GOAL-DONE');

    const server = codex.last;
    expect(server.sent('thread/goal/set')[0]).toEqual({ threadId: 'thread-1', objective: 'goal.txt says GOAL-DONE' });
    expect(server.sent('turn/start')).toHaveLength(0);
    expect(server.sent('thread/settings/update')[0]).not.toHaveProperty('approvalPolicy');
    expect(turns).toBe(2);
    expect(said(events)).toEqual(['Writing goal.txt.', 'goal.txt says GOAL-DONE.']);
    expect(events).toContainEqual(expect.objectContaining({ type: 'plugin_event', subtype: AGENT_GOAL_SUBTYPE, payload: expect.objectContaining({ status: 'complete' }) }));
    expect(events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_completed')).toBe(true);
    expect(session.modes.getActiveName()).toBe('default');
  });

  it('hands a new thread the conversation so far in the first turn of its goal', async () => {
    let handed = '';
    const { codex, session, pool } = connect(async (turn) => {
      if (turn.objective !== undefined) {
        handed = await turn.steered();
        turn.goal('complete');
      }
      turn.say('ok');
    });
    await collectTurn(session, 'use port 5433');
    await pool.close(String(session.id));
    codex.saved.clear();
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive('goal');

    await collectTurn(session, 'deploy on that port');

    expect(handed).toMatch(/^Your earlier session for this Moxxy conversation no longer exists[\s\S]*Person: use port 5433/);
    expect(codex.last.sent('thread/goal/set')[0]).toMatchObject({ objective: 'deploy on that port' });
  });

  it('leaves a goal Codex stopped on (blocked) to Codex, without Moxxy pushing it on', async () => {
    const { codex, session } = connect(async (turn) => {
      turn.say('I need the API key to go on.');
      turn.goal('blocked');
    });
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive('goal');

    await collectTurn(session, 'deploy it');

    // Codex starts the goal's turn itself; Moxxy adds no message of its own.
    expect(codex.last.sent('turn/start')).toHaveLength(0);
    expect(codex.turnCount).toBe(1);
    expect(session.modes.getActiveName()).toBe('goal');
  });

  it('runs the goal with full access even when the person has Codex ask, without changing the conversation auto-approve', async () => {
    const { codex, session } = connect(async (turn) => {
      if (turn.objective !== undefined) turn.goal('complete');
      turn.say('done');
    }, ASKING);
    await collectTurn(session, 'hello');
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive('goal');

    await collectTurn(session, 'finish it');

    expect(codex.last.sent('thread/settings/update').at(-1)).toMatchObject({ approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' } });
    expect(autoApproveOf(session)).toBe(false);
  });

  it('clears a met goal before setting the next one', async () => {
    const { codex, session } = connect(async (turn) => {
      turn.goal('complete');
      turn.say('done');
    });
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive('goal');
    await collectTurn(session, 'first goal');
    session.modes.setActive('goal');

    const events = await collectTurn(session, 'second goal');

    expect(codex.last.requests.map((r) => r.method).filter((m) => m.startsWith('thread/goal/'))).toEqual([
      'thread/goal/set',
      'thread/goal/clear',
      'thread/goal/set',
    ]);
    expect(said(events)).toEqual(['done']);
  });

  it('interrupts the goal on Stop and keeps it, so the next message carries on with it', async () => {
    const controller = new AbortController();
    let turns = 0;
    const { codex, session } = connect(async (turn) => {
      turns += 1;
      if (turns === 1) {
        turn.say('Counting.');
        controller.abort();
        await new Promise(() => undefined);
      }
      turn.goal('complete');
      turn.say(`carried on: ${turn.text}`);
    });
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive('goal');

    const stopped = await collectTurn(session, 'count to 300', { signal: controller.signal });
    const next = await collectTurn(session, 'go on');

    expect(codex.last.sent('turn/interrupt')).toEqual([{ threadId: 'thread-1', turnId: 'turn-1' }]);
    expect(stopped.map((e) => e.type)).toContain('abort');
    expect(codex.last.sent('thread/goal/set')).toHaveLength(1);
    expect(codex.last.sent('turn/start')[0]?.input).toEqual([{ type: 'text', text: 'go on', text_elements: [] }]);
    expect(said(next)).toEqual(['carried on: go on']);
  });

  it('clears an open goal when the conversation leaves goal mode', async () => {
    const controller = new AbortController();
    const { codex, session } = connect(async (turn) => {
      if (turn.objective !== undefined) {
        controller.abort();
        await new Promise(() => undefined);
      }
      turn.say('plain');
    });
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive('goal');
    await collectTurn(session, 'a goal', { signal: controller.signal });
    session.modes.setActive('default');

    const events = await collectTurn(session, 'just a question');

    expect(codex.last.sent('thread/goal/clear')).toHaveLength(1);
    expect(said(events)).toEqual(['plain']);
  });
});

describe('stopping and failing', () => {
  it('interrupts Codex on Stop, and the next message works as usual', async () => {
    const controller = new AbortController();
    const { codex, session } = connect(async (turn) => {
      if (turn.text === 'wait') {
        turn.started({ type: 'commandExecution', id: 'exec-1', command: "/bin/zsh -lc 'sleep 100'", cwd: '/work/app', status: 'inProgress', aggregatedOutput: null, exitCode: null });
        controller.abort();
        await new Promise(() => undefined);
      }
      turn.say('back');
    });

    const stopped = await collectTurn(session, 'wait', { signal: controller.signal });
    const next = await collectTurn(session, 'again');

    expect(codex.last.sent('turn/interrupt')).toHaveLength(1);
    expect(stopped.map((e) => e.type)).toContain('abort');
    expect(stopped).toContainEqual(expect.objectContaining({ type: 'tool_result', callId: 'exec-1', ok: false }));
    expect(said(next)).toEqual(['back']);
  });

  it('on Stop ends the commands the stopped turn started, and leaves running what an earlier turn started', async () => {
    const controller = new AbortController();
    const { codex, session } = connect(async (turn) => {
      if (turn.text === 'serve') {
        turn.started({ type: 'commandExecution', id: 'exec-server', command: "/bin/zsh -lc 'npm run dev'", cwd: '/work/app', status: 'inProgress', aggregatedOutput: null, exitCode: null });
        turn.say('The dev server runs.');
        return;
      }
      turn.started({ type: 'commandExecution', id: 'exec-wait', command: "/bin/zsh -lc 'sleep 100'", cwd: '/work/app', status: 'inProgress', aggregatedOutput: null, exitCode: null });
      controller.abort();
      await new Promise(() => undefined);
    });

    await collectTurn(session, 'serve');
    await collectTurn(session, 'wait', { signal: controller.signal });

    expect(codex.last.sent('thread/backgroundTerminals/terminate')).toEqual([{ threadId: 'thread-1', processId: '2' }]);
    expect([...codex.last.thread.terminals.keys()]).toEqual(['exec-server']);
  });

  it('shows the prompt of the last Codex call as how full the context is, not the sum of the turn', async () => {
    const { session } = connect(async (turn) => {
      turn.usage(150_000, 40, 148_000);
      turn.usage(152_000, 60, 150_000);
      turn.say('Done.');
    });

    const events = await collectTurn(session, 'fix it');

    expect(events.find((e) => e.type === 'provider_response')).toMatchObject({ contextTokens: 152_000 });
  });

  it('records the context window Codex runs the model with, for every surface to show', async () => {
    const { session } = connect(async (turn) => {
      turn.usage(1200, 40, 0, 380_000);
      turn.say('Hi.');
    });

    await collectTurn(session, 'hi');

    const model = session.getInfo().providers.find((p) => p.name === 'codex-agent')?.models.find((m) => m.id === CODEX_AGENT_DEFAULT_MODEL);
    expect(model?.contextWindow).toBe(380_000);
  });

  it('reports a failed Codex turn as an error', async () => {
    const { session } = connect(async () => ({ status: 'failed', error: 'You have hit your usage limit.' }));

    const events = await collectTurn(session, 'hi');

    expect(events).toContainEqual(expect.objectContaining({ type: 'error', kind: 'fatal', message: expect.stringContaining('usage limit') }));
  });

  it('ends the turn when Codex stops, and starts Codex again for the next message', async () => {
    let calls = 0;
    const { codex, session } = connect(async (turn) => {
      calls += 1;
      if (calls === 1) {
        turn.server.crash();
        await new Promise(() => undefined);
      }
      turn.say('fine now');
    });

    const failed = await collectTurn(session, 'hi');
    const next = await collectTurn(session, 'hi again');

    expect(failed).toContainEqual(expect.objectContaining({ type: 'error', kind: 'fatal', message: expect.stringContaining('Codex stopped') }));
    expect(codex.servers).toHaveLength(2);
    expect(said(next)).toEqual(['fine now']);
  });
});

describe("Codex's account limit", () => {
  /** As Codex 0.155.1 sent it on a Plus plan: one weekly window. `resetsAt` is in epoch seconds. */
  const rateLimits = (usedPercent: number, extra: Record<string, unknown> = {}) => ({
    rateLimits: {
      limitId: 'codex',
      limitName: null,
      primary: { usedPercent, windowDurationMins: 10080, resetsAt: 1792310000 },
      secondary: null,
      credits: { hasCredits: false, unlimited: false, balance: '0' },
      planType: 'plus',
      rateLimitReachedType: null,
      ...extra,
    },
  });
  const limitsIn = (events: ReadonlyArray<MoxxyEvent>) =>
    events.flatMap((e) => (e.type === 'plugin_event' && e.subtype === 'account_limit' ? [(e.payload as { limit: unknown }).limit] : []));

  it('reads how much of the window is used and when it resets, near from three quarters', async () => {
    let used = 10;
    const { session } = connect(async (turn) => {
      turn.server.notify('account/rateLimits/updated', rateLimits(used));
      turn.say('hi');
    });

    const first = await collectTurn(session, 'hi');
    used = 80;
    const second = await collectTurn(session, 'hi');

    expect(limitsIn(first)).toEqual([{ state: 'ok', usedPercent: 10, windowMinutes: 10080, resetsAt: 1792310000_000 }]);
    expect(limitsIn(second)).toEqual([{ state: 'near', usedPercent: 80, windowMinutes: 10080, resetsAt: 1792310000_000 }]);
  });

  it('keeps the window it knows when a rolling update leaves it out', async () => {
    let update = rateLimits(80);
    const { session } = connect(async (turn) => {
      turn.server.notify('account/rateLimits/updated', update);
      turn.say('hi');
    });

    await collectTurn(session, 'hi');
    update = rateLimits(0, { primary: null });
    const second = await collectTurn(session, 'hi');

    expect(limitsIn(second)).toEqual([]);
  });

  it('ends a turn Codex failed on its usage limit with the limit, not the raw error', async () => {
    const { session } = connect(async (turn) => {
      turn.server.notify('account/rateLimits/updated', rateLimits(100, { rateLimitReachedType: 'rate_limit_reached' }));
      return { status: 'failed', error: "You've hit your usage limit.", errorInfo: 'usageLimitExceeded' };
    });

    const events = await collectTurn(session, 'hi');

    expect(limitsIn(events)).toEqual([{ state: 'reached', usedPercent: 100, windowMinutes: 10080, resetsAt: 1792310000_000 }]);
    expect(events).toContainEqual(expect.objectContaining({ subtype: 'account_limit', payload: expect.objectContaining({ provider: 'codex-agent', agent: 'Codex' }) }));
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('knows the limit is reached from the failure alone when Codex sent no update before it', async () => {
    const { session } = connect(async () => ({ status: 'failed', error: "You've hit your usage limit.", errorInfo: 'usageLimitExceeded' }));

    const events = await collectTurn(session, 'hi');

    expect(limitsIn(events)).toEqual([{ state: 'reached' }]);
  });
});

describe('one-off text calls', () => {
  it('asks Codex for plain text on a read-only thread it does not keep', async () => {
    const codex = new FakeCodex(async (turn) => turn.say(`summary of: ${turn.text.slice(0, 19)}`));
    const provider = new CodexAgentProvider({ startAppServer: codex.start, cwd: '/work/app' });

    const out: string[] = [];
    for await (const event of provider.stream({
      model: 'gpt-6-luna',
      system: 'Summarize.',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'A long conversation' }] }],
    })) {
      if (event.type === 'text_delta') out.push(event.delta);
    }

    expect(out.join('')).toBe('summary of: A long conversation');
    expect(codex.last.sent('thread/start')[0]).toMatchObject({
      cwd: '/work/app',
      ephemeral: true,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      model: 'gpt-6-luna',
      developerInstructions: 'Summarize.',
    });
    expect(codex.last.closed).toBe(true);
  });

  it('gives Codex the instructions of the request as developer instructions, not as words the person said', async () => {
    const codex = new FakeCodex(async (turn) => turn.say(`asked: ${turn.text}`));
    const provider = new CodexAgentProvider({ startAppServer: codex.start, cwd: '/work/app' });

    const out: string[] = [];
    for await (const event of provider.stream({
      model: 'gpt-6-luna',
      messages: [
        { role: 'system', content: [{ type: 'text', text: 'Plan search queries.' }] },
        { role: 'user', content: [{ type: 'text', text: 'Find the release date.' }] },
      ],
    })) {
      if (event.type === 'text_delta') out.push(event.delta);
    }

    expect(out.join('')).toBe('asked: Find the release date.');
    expect(codex.last.sent('thread/start')[0]).toMatchObject({ developerInstructions: 'Plan search queries.' });
  });
});

describe('an MCP server set up both in Moxxy and in Codex', () => {
  it("reaches Codex once, through Codex's own setup; one switched off there is still lent", async () => {
    const mcpTool = (name: string) => defineTool({ name, description: name, inputSchema: z.object({}), handler: async () => 'ok' });
    const results: Record<string, { isError?: boolean }> = {};
    const { codex, session } = connect(
      async (turn) => {
        for (const name of ['mcp__notes__read', 'mcp__vault__secret_word']) results[name] = await turn.callMoxxyTool(name, {});
        turn.say('ok');
      },
      { mcpServers: { vault: { enabled: true }, notes: { enabled: false } } },
    );
    session.pluginHost.registerStatic(definePlugin({ name: 'mcp-servers', tools: [mcpTool('mcp__vault__secret_word'), mcpTool('mcp__notes__read')] }));
    session.setPermissionResolver(allowAll);

    await collectTurn(session, 'which tools?');
    await collectTurn(session, 'and now?');

    expect(results['mcp__notes__read']?.isError).toBeFalsy();
    expect(results['mcp__vault__secret_word']?.isError).toBe(true);
    expect(codex.last.sent('thread/start')).toHaveLength(1);
  });
});

describe('the Moxxy tools Codex gets', () => {
  it('include recall, which searches the whole conversation, and not what Codex has its own of', () => {
    const tools = ['Read', 'recall', 'session_recall', 'present_view'].map((name) => ({ name }) as ToolDef);

    expect(toolsLentToCodex(tools).map((tool) => tool.name)).toEqual(['recall', 'present_view']);
  });
});

describe('work Codex leaves running when its turn ends', () => {
  /** Codex does not start a turn when it finishes (checked with 0.155.1): Moxxy opens one to show the end, sending Codex nothing. */
  async function leaveRunning(start: (turn: Parameters<CodexScene>[0]) => void) {
    let later: ((method: string, params: Record<string, unknown>) => void) | undefined;
    let ids = { threadId: '', turnId: '' };
    const { codex, session, pool } = connect(async (turn) => {
      if (turn.text === '2+2?') return turn.say('4');
      ids = { threadId: turn.threadId, turnId: turn.id };
      later = (method, params) => turn.server.notify(method, params);
      start(turn);
      turn.say('started');
    });
    session.setPermissionResolver(allowAll);
    const first = await collectTurn(session, 'Start it and do not wait');
    return { codex, session, pool, first, ids, later: (method: string, params: Record<string, unknown>) => later?.(method, params) };
  }

  const opened = (session: Session) => session.log.ofType('user_prompt').filter((e) => e.origin?.kind === 'agent');

  it('shows a command still running in the background as such, and its end in a turn Moxxy opens for it', async () => {
    const command = { type: 'commandExecution', id: 'bg-1', command: "/bin/zsh -lc 'sleep 25 && echo BG-OK'", cwd: '/work/app', status: 'inProgress', aggregatedOutput: null, exitCode: null };
    const { codex, session, first, ids, later } = await leaveRunning((turn) => turn.started(command));

    expect(first.filter((e) => e.type === 'tool_result')).toEqual([
      expect.objectContaining({ callId: 'bg-1', ok: true, output: 'Still running in the background when Codex ended its turn.' }),
    ]);

    later('item/completed', { ...ids, item: { ...command, status: 'completed', aggregatedOutput: 'BG-OK\n', exitCode: 0 } });
    await vi.waitFor(() => expect(opened(session)).toHaveLength(1));
    const turn = opened(session)[0];
    await vi.waitFor(() => expect(session.log.slice().some((e) => e.type === 'provider_response' && turn && e.turnId === turn.turnId)).toBe(true));

    expect(turn).toMatchObject({ origin: { kind: 'agent', name: 'A command Codex left running finished' } });
    const inIt = session.log.slice().filter((e) => turn && e.turnId === turn.turnId);
    expect(inIt.filter((e) => e.type === 'tool_call_requested')).toEqual([expect.objectContaining({ name: 'Bash', input: { command: 'sleep 25 && echo BG-OK', cwd: '/work/app' } })]);
    expect(inIt.filter((e) => e.type === 'tool_result')).toEqual([expect.objectContaining({ ok: true, output: 'BG-OK\n' })]);
    expect(codex.last.sent('turn/start')).toHaveLength(1);

    expect(said(await collectTurn(session, '2+2?'))).toEqual(['4']);
  });

  it('opens the turn when the conversation went to another connection and came back while the command ran', async () => {
    const command = { type: 'commandExecution', id: 'bg-2', command: "/bin/zsh -lc 'sleep 20'", cwd: '/work/app', status: 'inProgress', aggregatedOutput: null, exitCode: null };
    const { codex, session, pool, ids, later } = await leaveRunning((turn) => turn.started(command));
    addFakeProvider(session, new FakeProvider({ name: 'stand-in', script: [] }));

    // The runner switches connections this way: a fresh client each time the conversation comes back.
    session.providers.setActive('stand-in');
    session.providers.replace(
      defineProvider({ name: 'codex-agent', models: [], createClient: () => new CodexAgentProvider({ startAppServer: codex.start, sessions: pool }) }),
    );
    session.providers.setActive('codex-agent');

    later('item/completed', { ...ids, item: { ...command, status: 'completed', aggregatedOutput: '', exitCode: 0 } });
    await vi.waitFor(() => expect(opened(session)).toHaveLength(1));
  });

  it("shows a subagent's work and answer after the turn in a turn Moxxy opens for it", async () => {
    const activity = (kind: string) => ({ type: 'subAgentActivity', id: `act-${kind}`, kind, agentThreadId: 'thread-child', agentPath: '/root/check_later' });
    const child = { threadId: 'thread-child', turnId: 'turn-child' };
    const { codex, session, ids, later } = await leaveRunning((turn) => turn.server.notify('item/started', { threadId: turn.threadId, turnId: turn.id, item: activity('started') }));

    later('item/completed', { ...child, item: { type: 'commandExecution', id: 'exec-c', command: 'sleep 25', cwd: '/work/app', status: 'completed', aggregatedOutput: '', exitCode: 0 } });
    later('item/completed', { ...child, item: { type: 'agentMessage', id: 'msg-c', text: 'DONE-7', phase: 'final_answer' } });
    later('item/started', { ...ids, turnId: 'turn-x', item: activity('completed') });
    await vi.waitFor(() => expect(opened(session)).toHaveLength(1));
    const turn = opened(session)[0];
    await vi.waitFor(() => expect(session.log.slice().some((e) => e.type === 'provider_response' && turn && e.turnId === turn.turnId)).toBe(true));

    expect(turn).toMatchObject({ origin: { kind: 'agent', name: 'check later finished in the background' } });
    const inIt = session.log.slice().filter((e) => turn && e.turnId === turn.turnId);
    expect(inIt.flatMap((e) => (e.type === 'plugin_event' ? [[e.subtype, e.payload]] : []))).toEqual(
      expect.arrayContaining([
        ['subagent_tool_call', expect.objectContaining({ childSessionId: 'thread-child', name: 'Bash' })],
        ['subagent_completed', expect.objectContaining({ childSessionId: 'thread-child', text: 'DONE-7' })],
      ]),
    );
    expect(codex.last.sent('turn/start')).toHaveLength(1);
  });

  it('shows what finished while the person was already writing in their next turn instead', async () => {
    const command = { type: 'commandExecution', id: 'bg-2', command: 'sleep 1', cwd: '/work/app', status: 'inProgress', aggregatedOutput: null, exitCode: null };
    const { session, ids, later } = await leaveRunning((turn) => turn.started(command));
    const prompt = collectTurn(session, '2+2?');
    later('item/completed', { ...ids, item: { ...command, status: 'completed', aggregatedOutput: 'ok', exitCode: 0 } });

    const next = await prompt;
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(said(next)).toEqual(['4']);
    const shown = session.log.slice().filter((e) => e.type === 'tool_result' && e.ok && e.output === 'ok');
    expect(shown).toHaveLength(1);
  });
});
