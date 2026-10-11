/**
 * The Codex agent connection, end to end: a real Moxxy session and loop drive
 * `agentStep`, and Codex itself is the stand-in at the `codex app-server`
 * boundary (fake-codex.testkit.ts). Nothing between them is replaced.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AGENT_GOAL_SUBTYPE,
  QUESTION_ASKED,
  autoApproveFromEvents,
  definePlugin,
  defineTool,
  type MoxxyEvent,
  type PermissionResolver,
  type QuestionItem,
  type ToolDef,
} from '@moxxy/sdk';
import { collectTurn, type Session } from '@moxxy/core';
import { createFakeSession } from '@moxxy/testing';
import { defaultModePlugin } from '@moxxy/mode-default';
import { planModePlugin } from '@moxxy/mode-plan';
import { goalModePlugin } from '@moxxy/mode-goal';
import { AgentSessionPool } from '@moxxy/agent-connection-kit';
import { CodexAgentProvider, codexAgentModels } from './agent-provider.js';
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

describe('a turn on the Codex agent connection', () => {
  it('starts Codex in the conversation folder with only Moxxy MCP server added, and shows what Codex did', async () => {
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
    // Codex runs as the person set it up: no instructions, policy, sandbox or model of Moxxy's.
    expect(Object.keys(start ?? {}).sort()).toEqual(['config', 'cwd']);
    expect(start).toMatchObject({ cwd: '/work/app', config: { mcp_servers: { moxxy: { url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/) } } } });
    expect(server.sent('turn/start')[0]).toMatchObject({ threadId: 'thread-1', input: [{ type: 'text', text: 'Run echo spike-ok', text_elements: [] }] });
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_call_requested', name: 'Bash', input: { command: 'echo spike-ok', cwd: '/work/app' }, executedBy: 'provider' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_result', ok: true, output: 'spike-ok\n' }));
    expect(said(events)).toEqual(['You said: Run echo spike-ok']);
    expect(events).toContainEqual(expect.objectContaining({ type: 'provider_response', inputTokens: 200, outputTokens: 40, cacheReadTokens: 1000 }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'plugin_event', subtype: 'agent_session', payload: expect.objectContaining({ sessionId: 'thread-1' }) }));
  });

  it('runs the model the person picked on the thread', async () => {
    const { codex, session } = connect(async (turn) => turn.say(turn.thread.model));

    const events = await collectTurn(session, 'which model?');

    expect(codex.last.sent('thread/settings/update')[0]).toMatchObject({ threadId: 'thread-1', model: codexAgentModels[0]?.id });
    expect(said(events)).toEqual([codexAgentModels[0]?.id]);
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
    expect(codex.last.sent('thread/resume')[0]).toMatchObject({ threadId: 'thread-1', cwd: '/work/app' });
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
    expect(codex.last.thread).toMatchObject(ASKING);

    await session.setAutoApprove(true);
    await collectTurn(session, 'three');
    expect(codex.last.thread).toMatchObject({ approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' } });
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
});

describe('the Moxxy tools Codex gets', () => {
  it('include recall, which searches the whole conversation, and not what Codex has its own of', () => {
    const tools = ['Read', 'recall', 'session_recall', 'present_view'].map((name) => ({ name }) as ToolDef);

    expect(toolsLentToCodex(tools).map((tool) => tool.name)).toEqual(['recall', 'present_view']);
  });
});
