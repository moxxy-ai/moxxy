/**
 * The Claude agent connection, end to end: a real Moxxy session and loop drive
 * `agentStep`, and Claude itself is the stand-in at the Agent SDK boundary
 * (fake-claude.testkit.ts). Nothing between them is replaced.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { removeDirSync } from '@moxxy/vitest-preset/fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  AGENT_GOAL_SUBTYPE,
  QUESTION_ASKED,
  assertDefined,
  autoApproveFromEvents,
  definePlugin,
  defineTool,
  type MoxxyEvent,
  type PermissionResolver,
  type QuestionItem,
  type Skill,
  type ToolDef,
} from '@moxxy/sdk';
import { buildSynthesizeSkillPlugin, collectTurn, type Session } from '@moxxy/core';
import { createFakeSession } from '@moxxy/testing';
import { defaultModePlugin } from '@moxxy/mode-default';
import { planModePlugin } from '@moxxy/mode-plan';
import { goalModePlugin } from '@moxxy/mode-goal';
import { AgentSessionPool } from '@moxxy/agent-connection-kit';
import { ClaudeAgentProvider, claudeCodeModels } from './agent-provider.js';
import type { ClaudeMessage } from './sdk-types.js';
import { ClaudeAgentSession, toolsLentToClaude } from './agent-session.js';
import { FakeClaude, assistantText, assistantToolUse, toolResult, type ClaudeScene, type FakeTurn } from './fake-claude.testkit.js';

const sessions: Session[] = [];
const pools: AgentSessionPool<ClaudeAgentSession>[] = [];
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.closeAll()));
  await Promise.all(sessions.splice(0).map((session) => session.close()));
});

function connect(scene: ClaudeScene, opts: { claude?: FakeClaude; pool?: AgentSessionPool<ClaudeAgentSession> } = {}) {
  const claude = opts.claude ?? new FakeClaude(scene);
  const pool = opts.pool ?? new AgentSessionPool<ClaudeAgentSession>({ limit: 4 });
  pools.push(pool);
  const provider = new ClaudeAgentProvider({
    executable: '/Users/me/.local/bin/claude',
    defaultModel: 'claude-opus-5-5',
    loadSdk: async () => claude,
    sessions: pool,
  });
  const session = createFakeSession({ provider });
  sessions.push(session);
  session.pluginHost.registerStatic(defaultModePlugin);
  return { claude, session, provider, pool };
}

const said = (events: ReadonlyArray<MoxxyEvent>) =>
  events.flatMap((e) => (e.type === 'assistant_message' && e.source === 'model' ? [e.content] : []));
const denyAll: PermissionResolver = { name: 'deny-all', check: async () => ({ mode: 'deny', reason: 'the person said no' }) };
const allowAll: PermissionResolver = { name: 'allow-all', check: async () => ({ mode: 'allow' }) };

describe('a turn on the Claude agent connection', () => {
  it('hands the person message to Claude Code, unchanged, and shows what Claude did', async () => {
    const { claude, session } = connect(async function* (turn) {
      yield assistantToolUse('toolu_1', 'Bash', { command: 'echo spike-ok' });
      yield toolResult('toolu_1', 'spike-ok');
      yield assistantText(`You said: ${turn.text}`);
    });

    const events = await collectTurn(session, 'Run echo spike-ok');

    const { options, received } = claude.last;
    expect(options.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code' });
    expect(options.pathToClaudeCodeExecutable).toBe('/Users/me/.local/bin/claude');
    // The model is the conversation's choice (a fresh one starts on the first Claude model).
    expect(options.model).toBe(claudeCodeModels[0]?.id);
    expect(options.includePartialMessages).toBe(true);
    expect(options.mcpServers?.moxxy?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(received[0]).toMatchObject({ message: { role: 'user', content: [{ type: 'text', text: 'Run echo spike-ok' }] }, origin: { kind: 'human' } });
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_call_requested', callId: 'toolu_1', name: 'Bash', executedBy: 'provider' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_result', callId: 'toolu_1', ok: true, output: 'spike-ok' }));
    expect(said(events)).toEqual(['You said: Run echo spike-ok']);
    expect(events).toContainEqual(expect.objectContaining({ type: 'provider_response', inputTokens: 3, outputTokens: 7 }));
  });

  it('keeps the same Claude running for the next message of the conversation', async () => {
    const { claude, session } = connect(async function* (turn) {
      yield assistantText(turn.text === 'first' ? 'one' : 'two');
    });

    await collectTurn(session, 'first');
    const second = await collectTurn(session, 'second');

    expect(claude.queries).toHaveLength(1);
    expect(claude.last.received).toHaveLength(2);
    expect(said(second)).toEqual(['two']);
  });

  it('resumes Claude own session when its process was closed and the conversation goes on', async () => {
    const { claude, session, pool } = connect(async function* () {
      yield assistantText('ok');
    });
    await collectTurn(session, 'remember MARMOT-55');
    await pool.close(String(session.id));

    await collectTurn(session, 'which word?');

    expect(claude.queries).toHaveLength(2);
    expect(claude.queries[0]?.closed).toBe(true);
    expect(claude.last.options.resume).toBe('claude-session-1');
  });

  it('goes on in a new Claude session, with the conversation so far, when Claude no longer has its own', async () => {
    const { claude, session, pool } = connect(async function* (turn) {
      yield assistantText(turn.text.includes('which port?') ? '5433' : 'port 5433 it is');
    });
    await collectTurn(session, 'use port 5433');
    await pool.close(String(session.id));
    claude.saved.clear();

    const events = await collectTurn(session, 'which port?');
    await collectTurn(session, 'thanks');

    expect(claude.last.options.resume).toBeUndefined();
    const [first, second] = claude.last.received.map((m) => m.message.content) as Array<Array<{ text: string }>>;
    expect(first?.[0]?.text).toMatch(/^Your earlier session for this Moxxy conversation no longer exists/);
    expect(first?.[0]?.text).toContain('### Turn 1\nPerson: use port 5433\nAgent: port 5433 it is');
    expect(first?.[1]?.text).toBe('which port?');
    expect(second).toEqual([{ type: 'text', text: 'thanks' }]);
    expect(said(events)).toEqual(['5433']);
    expect(events).toContainEqual(expect.objectContaining({ type: 'plugin_event', subtype: 'agent_session', payload: { provider: 'claude-code', sessionId: 'claude-session-2' } }));
  });

  it('hands the conversation so far over before a goal, since /goal must start its own message', async () => {
    const { claude, session, pool } = connect(async function* (turn) {
      if (turn.text === '/goal') {
        yield assistantText('Goal active: the site is deployed', '<synthetic>');
        return;
      }
      yield assistantText('ok');
    });
    await collectTurn(session, 'use port 5433');
    await pool.close(String(session.id));
    claude.saved.clear();
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive('goal');

    await collectTurn(session, 'the site is deployed');

    const sent = claude.last.received.map((m) => m.message.content);
    expect(String(sent[0])).toMatch(/^Your earlier session[\s\S]*use port 5433[\s\S]*Reply with OK only/);
    expect(sent.slice(1)).toEqual([[{ type: 'text', text: '/goal the site is deployed' }], '/goal']);
  });
});

describe('approvals', () => {
  it('asks the person before Claude runs a tool, and tells Claude why it may not', async () => {
    let answer: unknown;
    const { session } = connect(async function* (turn) {
      yield assistantToolUse('toolu_2', 'Bash', { command: 'touch spike.txt' });
      answer = await turn.canUseTool('Bash', { command: 'touch spike.txt' }, 'toolu_2');
      yield toolResult('toolu_2', 'The user refused this command.', true);
      yield assistantText('I could not create it.');
    });
    session.setPermissionResolver(denyAll);

    const events = await collectTurn(session, 'create spike.txt');

    expect(answer).toEqual({ behavior: 'deny', message: 'the person said no' });
    const order = events.filter((e) => 'callId' in e && e.callId === 'toolu_2').map((e) => e.type);
    expect(order).toEqual(['tool_call_requested', 'tool_call_denied', 'tool_result']);
  });

  it('lets Claude go ahead when the person allows', async () => {
    let answer: unknown;
    const { session } = connect(async function* (turn) {
      answer = await turn.canUseTool('Edit', { file_path: 'math.js' }, 'toolu_3');
      yield assistantText('Edited.');
    });
    session.setPermissionResolver(allowAll);

    await collectTurn(session, 'fix math.js');

    expect(answer).toEqual({ behavior: 'allow', updatedInput: { file_path: 'math.js' } });
  });

  it('checks Moxxy rules before every call Claude makes, without asking the person', async () => {
    let verdict: unknown;
    const { session } = connect(async function* (turn) {
      yield assistantToolUse('toolu_4', 'Bash', { command: 'echo forbidden-word' });
      verdict = await turn.preToolUse('Bash', { command: 'echo forbidden-word' }, 'toolu_4');
      yield toolResult('toolu_4', 'PreToolUse:Bash hook error: blocked by a Moxxy rule', true);
    });
    session.pluginHost.registerStatic(
      definePlugin({
        name: '@moxxy/test-rule',
        hooks: { onToolCall: ({ call }) => (JSON.stringify(call.input).includes('forbidden') ? { action: 'deny', reason: 'blocked by a Moxxy rule' } : undefined) },
      }),
    );

    await collectTurn(session, 'say forbidden-word');

    expect(verdict).toEqual({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'blocked by a Moxxy rule' },
    });
  });

  it("shows a subagent's calls under the subagent only, also when Moxxy checks them before the subagent's message arrives", async () => {
    const { session } = connect(async function* (turn) {
      yield assistantToolUse('toolu_agent', 'Agent', { description: 'Look around', prompt: 'list files', subagent_type: 'Explore' });
      await turn.preToolUse('Bash', { command: 'ls' }, 'toolu_sub1', 'a1');
      await turn.canUseTool('Edit', { file_path: 'a.txt' }, 'toolu_sub2', { agentID: 'a1' });
      yield {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'toolu_sub1', name: 'Bash', input: { command: 'ls' } }] },
        parent_tool_use_id: 'toolu_agent',
      } as ClaudeMessage;
      yield assistantText('Done.');
    });
    session.setPermissionResolver(allowAll);

    const events = await collectTurn(session, 'look around with a helper');

    expect(events.filter((e) => e.type === 'tool_call_requested')).toEqual([]);
    expect(events.filter((e) => e.type === 'plugin_event').map((e) => e.subtype)).toEqual(
      expect.arrayContaining(['subagent_started', 'subagent_tool_call']),
    );
  });

  it('takes Claude real permission mode as the conversation auto-approve, and changes Claude when the person does', async () => {
    const { claude, session } = connect(async function* () {
      yield assistantText('ok');
    });
    session.setPermissionResolver(allowAll);

    await collectTurn(session, 'first');
    expect(autoApproveFromEvents(session.log.ofType('plugin_event'))).toBe(false);
    await session.setAutoApprove(true);
    await collectTurn(session, 'second');

    expect(claude.last.modeChanges).toEqual(['bypassPermissions']);
    expect(claude.last.options.allowDangerouslySkipPermissions).toBe(true);
    expect(autoApproveFromEvents(session.log.ofType('plugin_event'))).toBe(true);
  });

  it('shows auto-approve off when Claude leaves bypass permissions without Moxxy asking, and leaves it so', async () => {
    const { claude, session } = connect(async function* () {
      yield assistantText('ok');
    });
    session.setPermissionResolver(allowAll);
    await collectTurn(session, 'first');
    await session.setAutoApprove(true);
    await collectTurn(session, 'second');

    claude.last.changeModeElsewhere('default');
    const events = await collectTurn(session, 'third');

    expect(autoApproveFromEvents(session.log.ofType('plugin_event'))).toBe(false);
    expect(claude.last.modeChanges).toEqual(['bypassPermissions']);
    expect(claude.last.permissionMode).toBe('default');
    expect(events).toContainEqual(expect.objectContaining({ type: 'plugin_event', subtype: 'auto_approve', payload: { enabled: false, elsewhere: true } }));
  });

  it('sets Claude back to asking when its mode is switched to bypass permissions outside Moxxy between turns', async () => {
    const { claude, session } = connect(async function* () {
      yield assistantText('ok');
    });
    session.setPermissionResolver(allowAll);
    await collectTurn(session, 'first');

    claude.last.changeModeElsewhere('bypassPermissions');
    const events = await collectTurn(session, 'second');

    expect(autoApproveFromEvents(session.log.ofType('plugin_event'))).toBe(false);
    expect(claude.last.modeChanges).toEqual(['default']);
    expect(claude.last.permissionMode).toBe('default');
    expect(events).toContainEqual(expect.objectContaining({ type: 'plugin_event', subtype: 'auto_approve_restored' }));
  });

  it('sets Claude back at once when its mode is loosened outside Moxxy in the middle of a turn', async () => {
    const { claude, session } = connect(async function* (turn) {
      if (turn.text === 'second') turn.query.changeModeElsewhere('auto');
      yield assistantText('ok');
    });
    session.setPermissionResolver(allowAll);
    await collectTurn(session, 'first');

    await collectTurn(session, 'second');

    expect(autoApproveFromEvents(session.log.ofType('plugin_event'))).toBe(false);
    expect(claude.last.permissionMode).toBe('default');
  });

  it("shows the person's own Claude setup as it is when it starts in bypass permissions", async () => {
    const scene: ClaudeScene = async function* () {
      yield assistantText('ok');
    };
    const { session } = connect(scene, { claude: new FakeClaude(scene, 'bypassPermissions') });
    session.setPermissionResolver(allowAll);

    await collectTurn(session, 'first');

    expect(autoApproveFromEvents(session.log.ofType('plugin_event'))).toBe(true);
  });

  it("keeps auto-approve off once the person turned it off, over their own Claude's bypass permissions", async () => {
    const scene: ClaudeScene = async function* () {
      yield assistantText('ok');
    };
    const { claude, session, pool } = connect(scene, { claude: new FakeClaude(scene, 'bypassPermissions') });
    session.setPermissionResolver(allowAll);
    await session.setAutoApprove(true);
    await session.setAutoApprove(false);

    await collectTurn(session, 'first');
    expect(claude.last.options.permissionMode).toBe('default');
    await pool.close(String(session.id));
    await collectTurn(session, 'second');

    expect(claude.last.options).toMatchObject({ resume: 'claude-session-1', permissionMode: 'default' });
    expect(autoApproveFromEvents(session.log.ofType('plugin_event'))).toBe(false);
  });

  it('keeps the auto-approve the person chose when a new Claude resumes the session', async () => {
    const { claude, session, pool } = connect(async function* () {
      yield assistantText('ok');
    });
    session.setPermissionResolver(allowAll);
    await collectTurn(session, 'first');
    await session.setAutoApprove(true);
    await collectTurn(session, 'second');
    await pool.close(String(session.id));

    await collectTurn(session, 'third');
    expect(claude.last.options).toMatchObject({ resume: 'claude-session-1', permissionMode: 'bypassPermissions' });
    expect(autoApproveFromEvents(session.log.ofType('plugin_event'))).toBe(true);

    await session.setAutoApprove(false);
    await collectTurn(session, 'fourth');
    await pool.close(String(session.id));
    await collectTurn(session, 'fifth');
    expect(claude.last.options.permissionMode).toBeUndefined();
    expect(autoApproveFromEvents(session.log.ofType('plugin_event'))).toBe(false);
  });
});

describe('Moxxy tools for Claude', () => {
  it('lends Claude only the Moxxy tools it lacks, and runs them through Moxxy', async () => {
    let fromMoxxy: unknown;
    let listed: string[] = [];
    const { session } = connect(async function* (turn) {
      const client = await turn.query.moxxyClient();
      listed = (await client.listTools()).tools.map((t) => t.name);
      yield assistantToolUse('toolu_5', 'mcp__moxxy__browser_title', { url: 'https://example.com' });
      fromMoxxy = await turn.callMoxxyTool('browser_title', { url: 'https://example.com' });
      yield toolResult('toolu_5', 'Example Domain');
      yield assistantText('The title is Example Domain.');
    });
    session.setPermissionResolver(allowAll);
    session.tools.register(
      defineTool({ name: 'browser_title', description: 'Read a page title', inputSchema: z.object({ url: z.string() }), handler: async () => 'Example Domain' }),
    );
    session.tools.register(defineTool({ name: 'Read', description: 'Read a file', inputSchema: z.object({}), handler: async () => '' }));

    const events = await collectTurn(session, 'title of example.com?');

    expect(listed).toContain('browser_title');
    expect(listed).not.toContain('Read');
    expect(fromMoxxy).toEqual({ content: [{ type: 'text', text: 'Example Domain' }] });
    const requests = events.filter((e) => e.type === 'tool_call_requested');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ name: 'browser_title' });
    expect(requests[0]).not.toHaveProperty('executedBy');
  });

  it('lets Claude call a Moxxy tool without a second approval window', async () => {
    let answer: unknown;
    const { session } = connect(async function* (turn) {
      answer = await turn.canUseTool('mcp__moxxy__browser_title', {}, 'toolu_6', { mcpServer: { name: 'moxxy', source: 'dynamic' } });
      yield assistantText('ok');
    });
    session.setPermissionResolver(denyAll);

    await collectTurn(session, 'go');

    expect(answer).toEqual({ behavior: 'allow', updatedInput: {} });
  });
});

describe('questions', () => {
  it('shows Claude question in Moxxy and hands back the answer keyed by the question', async () => {
    let answer: unknown;
    const { session } = connect(async function* (turn) {
      const input = { questions: [{ question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red' }, { label: 'Blue' }] }] };
      answer = await turn.canUseTool('AskUserQuestion', input, 'toolu_7');
      yield assistantText('Blue it is.');
    });
    session.questions.attachSurface();
    session.log.subscribe((event) => {
      if (event.type === 'plugin_event' && event.subtype === QUESTION_ASKED) {
        const { questionId, questions } = event.payload as { questionId: string; questions: QuestionItem[] };
        const blue = questions[0]?.options.find((o) => o.label === 'Blue');
        void session.questions.answer(questionId, { [questions[0]?.id ?? '']: { selected: blue ? [blue.id] : [] } });
      }
    });

    await collectTurn(session, 'make a button');

    expect(answer).toMatchObject({ behavior: 'allow', updatedInput: { answers: { 'Which colour?': 'Blue' } } });
  });

  it('tells Claude nobody can answer when no window shows questions', async () => {
    let answer: unknown;
    const { session } = connect(async function* (turn) {
      answer = await turn.canUseTool('AskUserQuestion', { questions: [{ question: 'Which?', options: [] }] }, 'toolu_8');
      yield assistantText('ok');
    });

    await collectTurn(session, 'go');

    expect(answer).toMatchObject({ behavior: 'deny', message: expect.stringMatching(/nobody/i) });
  });
});

describe('Moxxy modes on Claude', () => {
  it('plans in Claude own plan mode, and hands the plan to the person as the plan card, not a permission prompt', async () => {
    let answer: unknown;
    const { claude, session } = connect(async function* (turn) {
      answer = await turn.canUseTool('ExitPlanMode', { plan: '# Fix add\n\n- use a + b' }, 'toolu_9');
      yield assistantText('Waiting for your decision.');
    });
    session.pluginHost.registerStatic(planModePlugin);
    session.modes.setActive('plan');
    const asked: string[] = [];
    session.setPermissionResolver({
      name: 'remember-asks',
      check: async (call) => {
        asked.push(call.name);
        return { mode: 'allow' };
      },
    });

    const events = await collectTurn(session, 'plan the fix');

    expect(claude.last.options.permissionMode).toBe('plan');
    expect(asked).not.toContain('ExitPlanMode');
    // Handed over, not failed: the call is no red row over the plan.
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_result', callId: 'toolu_9', ok: true }));
    expect(answer).toMatchObject({ behavior: 'deny', message: expect.stringContaining('Moxxy') });
    expect(session.log.ofType('plugin_event').map((e) => e.subtype)).toContain('plan_completed');
    expect(session.log.ofType('assistant_message').at(-1)?.content).toBe('# Fix add\n\n- use a + b');
  });

  it('shows the plan Claude wrote to its plan file when it ends a plan turn without handing it over', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'moxxy-claude-plan-'));
    const planFile = join(dir, '.claude', 'plans', 'round-up.md');
    mkdirSync(dirname(planFile), { recursive: true });
    const { session } = connect(async function* () {
      writeFileSync(planFile, '# Round up\n\n- use a toggle');
      yield assistantToolUse('toolu_3', 'Edit', { file_path: planFile, old_string: 'checkbox', new_string: 'toggle' });
      yield toolResult('toolu_3', 'The file was updated.');
      yield assistantText('Plan rewritten. Ready for approval.');
    });
    session.pluginHost.registerStatic(planModePlugin);
    session.modes.setActive('plan');

    await collectTurn(session, 'use a toggle instead');

    expect(session.log.ofType('plugin_event').map((e) => e.subtype)).toContain('plan_completed');
    expect(session.log.ofType('assistant_message').at(-1)?.content).toBe('# Round up\n\n- use a toggle');
    removeDirSync(dir);
  });

  it('leaves a file Claude edits outside its plans folder, or outside plan mode, as a plain edit', async () => {
    const { session } = connect(async function* () {
      yield assistantToolUse('toolu_4', 'Edit', { file_path: '/work/app/index.html', old_string: 'a', new_string: 'b' });
      yield toolResult('toolu_4', 'The file was updated.');
      yield assistantText('Done.');
    });
    session.pluginHost.registerStatic(planModePlugin);
    session.modes.setActive('plan');

    await collectTurn(session, 'look around');

    expect(session.log.ofType('plugin_event').map((e) => e.subtype)).not.toContain('plan_completed');
  });

  it('still asks the person to approve a plan Claude leaves its plan mode with outside Moxxy plan mode', async () => {
    let answer: unknown;
    const { session } = connect(async function* (turn) {
      answer = await turn.canUseTool('ExitPlanMode', { plan: '# Fix add' }, 'toolu_9');
      yield assistantText('Fixed.');
    });
    let described: string | undefined;
    session.setPermissionResolver({
      name: 'remember-description',
      check: async (_call, ctx) => {
        described = ctx?.toolDescription;
        return { mode: 'allow' };
      },
    });

    await collectTurn(session, 'fix it');

    expect(described).toContain('# Fix add');
    expect(answer).toMatchObject({ behavior: 'allow' });
  });

  it('leaves a goal Claude still has open to Claude, without Moxxy pushing it on', async () => {
    const { claude, session } = connect(async function* (turn) {
      if (turn.text === '/goal') {
        yield assistantText('Goal active: the site is deployed', '<synthetic>');
        return;
      }
      yield assistantText('I need the API key to go on.');
    });
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive('goal');

    await collectTurn(session, 'the site is deployed');

    expect(claude.last.received.map((m) => m.message.content)).toEqual([[{ type: 'text', text: '/goal the site is deployed' }], '/goal']);
    expect(session.modes.getActiveName()).toBe('goal');
  });

  it('answers the next message after a goal turn, once Claude said how its goal stands', async () => {
    const { session } = connect(async function* (turn) {
      if (turn.text === '/goal') {
        yield assistantText('Goal active: the site is deployed', '<synthetic>');
        return;
      }
      yield assistantText(turn.text === 'and now?' ? 'Still deploying.' : 'Working on it.');
    });
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive('goal');
    await collectTurn(session, 'the site is deployed');
    session.modes.setActive('default');

    const events = await collectTurn(session, 'and now?');

    expect(said(events)).toEqual(['Still deploying.']);
  });

  it('runs a goal with Claude own /goal, and ends Moxxy goal mode when Claude says it is met', async () => {
    const { claude, session } = connect(async function* (turn) {
      if (turn.text === '/goal') {
        yield assistantText('No goal set. Usage: `/goal <condition>`', '<synthetic>');
        return;
      }
      yield assistantText('Goal set: goal.txt says GOAL-DONE', '<synthetic>');
      yield assistantText('goal.txt now says GOAL-DONE.');
    });
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive('goal');

    const events = await collectTurn(session, 'goal.txt says GOAL-DONE');

    expect(claude.last.received.map((m) => m.message.content)).toEqual([
      [{ type: 'text', text: '/goal goal.txt says GOAL-DONE' }],
      '/goal',
    ]);
    expect(claude.last.options.permissionMode).toBe('bypassPermissions');
    expect(said(events)).not.toContain('No goal set. Usage: `/goal <condition>`');
    expect(events).toContainEqual(expect.objectContaining({ type: 'plugin_event', subtype: AGENT_GOAL_SUBTYPE, payload: expect.objectContaining({ status: 'complete' }) }));
    expect(events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_completed')).toBe(true);
    expect(autoApproveFromEvents(session.log.ofType('plugin_event'))).toBe(false);
  });
});

describe('turns Claude takes up by itself', () => {
  const sub = (id: string, content: unknown[]): ClaudeMessage => ({ type: 'assistant', message: { content }, parent_tool_use_id: 'toolu_agent' }) as ClaudeMessage;
  const system = (fields: Record<string, unknown>): ClaudeMessage => ({ type: 'system', ...fields }) as ClaudeMessage;
  const launchInBackground = async function* (): AsyncIterable<ClaudeMessage> {
    yield assistantToolUse('toolu_agent', 'Agent', { description: 'List files', prompt: 'list the files', run_in_background: true });
    yield system({ subtype: 'task_started', task_id: 't1', tool_use_id: 'toolu_agent', description: 'List files', is_backgrounded: true });
    yield { ...toolResult('toolu_agent', 'Async agent launched'), tool_use_result: { isAsync: true, status: 'async_launched' } } as ClaudeMessage;
    yield assistantText('Started it in the background.');
  };
  const backgroundFinished = {
    background: [
      sub('toolu_agent', [{ type: 'tool_use', id: 'toolu_ls', name: 'Bash', input: { command: 'ls' } }]),
      sub('toolu_agent', [{ type: 'text', text: 'Two files.' }]),
      system({ subtype: 'task_notification', task_id: 't1', tool_use_id: 'toolu_agent', status: 'completed', summary: 'Two files.' }),
    ],
    messages: [assistantText('The helper found two files.')],
  };

  it("opens a Moxxy turn for it, marked as Claude's, with the background helper's work and what Claude said, sending Claude nothing", async () => {
    const { claude, session } = connect(async function* (turn) {
      if (turn.text === '2+2?') yield assistantText('4');
      else yield* launchInBackground();
    });
    session.setPermissionResolver(allowAll);
    await collectTurn(session, 'List the files in the background');

    claude.last.startOwnTurn(backgroundFinished);
    await vi.waitFor(() => expect(said(session.log.ofType('assistant_message'))).toContain('The helper found two files.'));

    const opened = session.log.ofType('user_prompt').at(-1);
    expect(opened).toMatchObject({ origin: { kind: 'agent', name: 'List files finished in the background' } });
    const inIt = session.log.slice().filter((e) => opened && e.turnId === opened.turnId);
    expect(inIt.filter((e) => e.type === 'plugin_event').map((e) => (e as { subtype: string }).subtype)).toEqual(
      expect.arrayContaining(['subagent_tool_call', 'subagent_completed']),
    );
    expect(claude.last.received).toHaveLength(1);

    const next = await collectTurn(session, '2+2?');
    expect(said(next)).toEqual(['4']);
  });

  it("checks Moxxy's rules for a background helper's call while no turn runs", async () => {
    let claudeTurn: FakeTurn | undefined;
    const { session } = connect(async function* (turn) {
      claudeTurn = turn;
      yield* launchInBackground();
    });
    session.setPermissionResolver(allowAll);
    session.pluginHost.registerStatic(
      definePlugin({
        name: '@moxxy/test-rule',
        hooks: { onToolCall: ({ call }) => (JSON.stringify(call.input).includes('forbidden') ? { action: 'deny', reason: 'blocked by a Moxxy rule' } : undefined) },
      }),
    );
    await collectTurn(session, 'List the files in the background');
    assertDefined(claudeTurn, 'Claude ran a turn');

    const blocked = await claudeTurn.preToolUse('Bash', { command: 'echo forbidden-word' }, 'toolu_bg1', 't1');
    const allowed = await claudeTurn.preToolUse('Bash', { command: 'ls' }, 'toolu_bg2', 't1');

    expect(blocked).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'blocked by a Moxxy rule' } });
    expect(allowed).toEqual({});
  });
});

describe('stopping and failing', () => {
  it('interrupts Claude on Stop, and the next message works as usual', async () => {
    const controller = new AbortController();
    const { claude, session } = connect(async function* (turn) {
      if (turn.text === 'wait') {
        yield assistantToolUse('toolu_10', 'Bash', { command: 'sleep 100' });
        controller.abort();
        await new Promise(() => {});
      }
      yield assistantText('back');
    });

    const stopped = await collectTurn(session, 'wait', { signal: controller.signal });
    const next = await collectTurn(session, 'again');

    expect(claude.last.interrupts).toBe(1);
    expect(stopped.map((e) => e.type)).toContain('abort');
    expect(stopped).toContainEqual(expect.objectContaining({ type: 'tool_result', callId: 'toolu_10', ok: false }));
    expect(said(next)).toEqual(['back']);
  });

  it('ends the turn with Claude own error, and starts Claude again for the next message', async () => {
    let calls = 0;
    const { claude, session } = connect(async function* () {
      calls += 1;
      if (calls === 1) throw new Error('Claude Code process exited with code 1');
      yield assistantText('fine now');
    });

    const failed = await collectTurn(session, 'hi');
    const next = await collectTurn(session, 'hi again');

    expect(failed).toContainEqual(expect.objectContaining({ type: 'error', kind: 'fatal', message: expect.stringContaining('exited with code 1') }));
    expect(claude.queries).toHaveLength(2);
    expect(said(next)).toEqual(['fine now']);
  });

  it('reports a failed Claude turn as an error', async () => {
    const { session } = connect(async function* (turn) {
      yield turn.query.result('error_max_turns', true, { errors: ['Reached the maximum number of turns'] });
    });

    const events = await collectTurn(session, 'hi');

    expect(events).toContainEqual(expect.objectContaining({ type: 'error', message: expect.stringContaining('maximum number of turns') }));
  });
});

describe('one-off text calls', () => {
  it('asks Claude for plain text without tools and without keeping a session', async () => {
    const claude = new FakeClaude(async function* (turn) {
      yield assistantText(`summary of: ${turn.text.slice(0, 20)}`);
    });
    const provider = new ClaudeAgentProvider({ defaultModel: 'claude-opus-5-5', loadSdk: async () => claude });

    const out: string[] = [];
    for await (const event of provider.stream({
      model: 'claude-opus-5-5',
      system: 'Summarize.',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'A long conversation' }] }],
    })) {
      if (event.type === 'text_delta') out.push(event.delta);
    }

    expect(out.join('')).toBe('summary of: A long conversation');
    expect(claude.last.options.tools).toEqual([]);
    expect(claude.last.options.persistSession).toBe(false);
    expect(claude.last.options.systemPrompt).toBe('Summarize.');
  });
});

describe('the Moxxy tools Claude can see', () => {
  const askLike = defineTool({ name: 'ask_like', description: 'Ask the person.', inputSchema: z.object({}), notInModes: ['goal'], handler: async () => 'answered' });

  it('are listed before Claude starts, since it reads them as it starts', async () => {
    const claude = new FakeClaude(async function* () {});
    const session = await ClaudeAgentSession.start({ sdk: claude, cwd: '/work', model: 'claude-opus-5-5', tools: [askLike] });

    const { tools } = await (await claude.last.moxxyClient()).listTools();
    await session.close();

    expect(tools.map((tool) => tool.name)).toEqual(['ask_like']);
  });

  it('stay the same between modes, and Claude hears why one is not available in this mode', async () => {
    const results: Array<{ content: unknown; isError?: boolean }> = [];
    const { session } = connect(async function* (turn) {
      if (turn.text === '/goal') {
        yield assistantText('Goal active: done', '<synthetic>');
        return;
      }
      if (turn.text.endsWith('do it') || turn.text === 'now ask me') results.push(await turn.callMoxxyTool('ask_like', {}));
      yield assistantText('ok');
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

  it('tells Claude when the conversation gains a tool, so it reads the list again', async () => {
    const noted = defineTool({ name: 'note_lookup', description: 'Look a note up.', inputSchema: z.object({}), handler: async () => 'the note' });
    const found: unknown[] = [];
    const { claude, session } = connect(async function* (turn) {
      if (turn.text === 'look it up') found.push(await turn.callMoxxyTool('note_lookup', {}));
      yield assistantText('ok');
    });
    await collectTurn(session, 'hello');
    session.pluginHost.registerStatic(definePlugin({ name: 'test-notes', tools: [noted] }));

    await collectTurn(session, 'look it up');

    expect(claude.queries).toHaveLength(1);
    expect(found).toEqual([expect.objectContaining({ content: [{ type: 'text', text: 'the note' }] })]);
  });
});

describe("the person's Moxxy skills on Claude", () => {
  const skill = (name: string): Skill => ({
    id: name as Skill['id'],
    path: `/skills/${name}.md`,
    scope: 'user',
    frontmatter: { name, description: `About ${name}` },
    body: `Steps for ${name}.`,
  });

  function withSkills(scene: ClaudeScene, ownSkills: string[] = []) {
    const claude = new FakeClaude(scene);
    claude.ownSkills = ownSkills;
    const connected = connect(scene, { claude });
    connected.session.pluginHost.registerStatic(buildSynthesizeSkillPlugin(connected.session));
    connected.session.setPermissionResolver(allowAll);
    return connected;
  }

  it("lists them in one tool Claude reads a skill with, leaving one Claude has itself to Claude's", async () => {
    let listed: string | undefined;
    let read: { content: unknown; isError?: boolean } | undefined;
    const { session } = withSkills(async function* (turn) {
      const { tools } = await (await turn.query.moxxyClient()).listTools();
      listed = tools.find((tool) => tool.name === 'load_skill')?.description;
      read = await turn.callMoxxyTool('load_skill', { name: 'monthly-invoices' });
      yield assistantText('ok');
    }, ['deploy-staging']);
    session.skills.register(skill('monthly-invoices'));
    session.skills.register(skill('deploy-staging'));

    const events = await collectTurn(session, 'do the invoices');

    expect(listed).toContain('- monthly-invoices: About monthly-invoices');
    expect(listed).not.toContain('deploy-staging');
    expect(read).toEqual({ content: [{ type: 'text', text: expect.stringContaining('Steps for monthly-invoices.') }] });
    expect(events).toContainEqual(expect.objectContaining({ type: 'skill_invoked', name: 'monthly-invoices' }));
  });

  it('reach Claude at its next turn when one is saved during the conversation', async () => {
    const read: Array<{ content: unknown; isError?: boolean }> = [];
    const { claude, session } = withSkills(async function* (turn) {
      if (turn.text === 'use it') read.push(await turn.callMoxxyTool('load_skill', { name: 'monthly-invoices' }));
      yield assistantText('ok');
    });
    await collectTurn(session, 'hello');
    session.skills.register(skill('monthly-invoices'));

    await collectTurn(session, 'use it');

    expect(claude.queries).toHaveLength(1);
    expect(read).toEqual([{ content: [{ type: 'text', text: expect.stringContaining('Steps for monthly-invoices.') }] }]);
  });
});

describe('the Moxxy tools Claude gets', () => {
  it('include recall, which searches the whole conversation, and not what Claude has its own of', () => {
    const tools = ['Read', 'recall', 'session_recall', 'present_view'].map((name) => ({ name }) as ToolDef);

    expect(toolsLentToClaude(tools).map((tool) => tool.name)).toEqual(['recall', 'present_view']);
  });
});
