/**
 * The OpenCode agent connection, end to end: a real Moxxy session and loop
 * drive `agentStep`, and OpenCode itself is the stand-in at the `opencode acp`
 * boundary (fake-opencode.testkit.ts). Nothing between them is replaced.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { autoApproveFromEvents, definePlugin, defineTool, type MoxxyEvent, type PermissionResolver } from '@moxxy/sdk';
import { collectTurn, type Session } from '@moxxy/core';
import { createFakeSession } from '@moxxy/testing';
import { defaultModePlugin } from '@moxxy/mode-default';
import { planModePlugin } from '@moxxy/mode-plan';
import { goalModePlugin } from '@moxxy/mode-goal';
import { AgentSessionPool } from '@moxxy/agent-connection-kit';
import { AcpAgentProvider } from './agent-provider.js';
import type { AcpAgentSession } from './acp-session.js';
import { FakeOpenCode, OPENCODE_DEFAULT_RULES, type FakeOpenCodeDefaults, type OpenCodeScene } from './fake-opencode.testkit.js';

const sessions: Session[] = [];
const pools: AgentSessionPool<AcpAgentSession>[] = [];
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.closeAll()));
  await Promise.all(sessions.splice(0).map((session) => session.close()));
});

function connect(scene: OpenCodeScene, defaults: FakeOpenCodeDefaults = {}, model = 'opencode/big-pickle') {
  const opencode = new FakeOpenCode(scene, defaults);
  const pool = new AgentSessionPool<AcpAgentSession>({ limit: 4 });
  pools.push(pool);
  const provider = new AcpAgentProvider({ startAgent: opencode.start, readRules: opencode.readRules, sessions: pool, model });
  const session = createFakeSession({ provider, cwd: '/work/app' });
  sessions.push(session);
  session.pluginHost.registerStatic(defaultModePlugin);
  return { opencode, session, provider, pool };
}

const said = (events: ReadonlyArray<MoxxyEvent>) =>
  events.flatMap((e) => (e.type === 'assistant_message' && e.source === 'model' ? [e.content] : []));
const shownCalls = (events: ReadonlyArray<MoxxyEvent>) =>
  events.flatMap((e) => (e.type === 'tool_call_requested' ? [{ name: e.name, input: e.input }] : []));
const allowAll: PermissionResolver = { name: 'allow-all', check: async () => ({ mode: 'allow' }) };
const allowForSession: PermissionResolver = { name: 'allow-session', check: async () => ({ mode: 'allow_session' }) };
const personSays = (reason: string): PermissionResolver => ({ name: 'person', check: async () => ({ mode: 'deny', reason }) });

describe('a turn on the OpenCode agent connection', () => {
  it('starts OpenCode in the conversation folder with only Moxxy MCP server added, and shows what OpenCode did', async () => {
    const { opencode, session } = connect(async (turn) => {
      await turn.tool('bash', 'execute', { command: 'echo spike-ok', cwd: '/work/app', description: 'Print a word' }, 'spike-ok\n', { title: 'echo spike-ok' });
      turn.usage({ inputTokens: 200, outputTokens: 30, thoughtTokens: 10, cachedReadTokens: 1000, totalTokens: 1240 });
      turn.say(`You said: ${turn.text}`);
    });

    const events = await collectTurn(session, 'Run echo spike-ok');

    const server = opencode.last;
    expect(server.cwd).toBe('/work/app');
    expect(server.sent('initialize')[0]).toEqual({
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'moxxy', title: 'Moxxy', version: expect.any(String) },
    });
    const [created] = server.sent('session/new');
    expect(created).toEqual({
      cwd: '/work/app',
      mcpServers: [
        {
          type: 'http',
          name: 'moxxy',
          url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/),
          headers: [{ name: 'Authorization', value: expect.stringMatching(/^Bearer /) }],
        },
      ],
    });
    // OpenCode runs as the person set it up: Moxxy changes no setting it does not need to.
    expect(server.sent('session/set_config_option')).toEqual([]);
    expect(server.sent('session/prompt')[0]).toEqual({ sessionId: 'ses_1', prompt: [{ type: 'text', text: 'Run echo spike-ok' }] });
    expect(shownCalls(events)).toEqual([{ name: 'Bash', input: { command: 'echo spike-ok', description: 'Print a word' } }]);
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_call_requested', name: 'Bash', executedBy: 'provider' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_result', ok: true, output: 'spike-ok\n' }));
    expect(said(events)).toEqual(['You said: Run echo spike-ok']);
    expect(events).toContainEqual(expect.objectContaining({ type: 'provider_response', inputTokens: 200, outputTokens: 40, cacheReadTokens: 1000 }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'plugin_event', subtype: 'agent_session', payload: { provider: 'opencode', sessionId: 'ses_1' } }));
  });

  it('shows OpenCode file, search and web tools under Moxxy names, and its message before each tool as its own', async () => {
    const { session } = connect(async (turn) => {
      turn.think('Look first.');
      turn.say('Reading.');
      await turn.tool('read', 'read', { filePath: '/work/app/math.js', limit: 20 }, 'export const add = (a, b) => a - b;', { title: 'math.js' });
      await turn.tool('glob', 'search', { pattern: '**/*.js' }, '/work/app/math.js', { title: '**/*.js' });
      await turn.tool('grep', 'search', { pattern: 'add\\(', path: '/work/app', include: '*.js' }, 'Found 1 match', { title: 'add\\(' });
      await turn.tool('edit', 'edit', { filePath: '/work/app/math.js', oldString: 'a - b', newString: 'a + b' }, 'Edit applied successfully.', { title: 'math.js' });
      await turn.tool('write', 'edit', { filePath: '/work/app/README.md', content: '# app' }, 'Wrote file successfully.', { title: 'README.md' });
      await turn.tool('webfetch', 'fetch', { url: 'https://example.com', format: 'markdown' }, '# Example', { title: 'https://example.com' });
      await turn.tool('todowrite', 'other', { todos: [{ content: 'fix add', status: 'completed' }] }, '[]', { title: '1 todos' });
      turn.say('Fixed add.');
    });

    const events = await collectTurn(session, 'fix add');

    expect(shownCalls(events)).toEqual([
      { name: 'Read', input: { file_path: '/work/app/math.js', limit: 20 } },
      { name: 'Glob', input: { pattern: '**/*.js' } },
      { name: 'Grep', input: { pattern: 'add\\(', path: '/work/app', glob: '*.js' } },
      { name: 'Edit', input: { file_path: '/work/app/math.js', old_string: 'a - b', new_string: 'a + b' } },
      { name: 'Write', input: { file_path: '/work/app/README.md', content: '# app' } },
      { name: 'web_fetch', input: { url: 'https://example.com', format: 'markdown' } },
      { name: 'TodoWrite', input: { todos: [{ content: 'fix add', status: 'completed' }] } },
    ]);
    expect(events).toContainEqual(expect.objectContaining({ type: 'reasoning_message', content: 'Look first.' }));
    const messages = events.filter((e) => e.type === 'assistant_message' && e.source === 'model');
    expect(messages).toEqual([
      expect.objectContaining({ content: 'Reading.', stopReason: 'tool_use' }),
      expect.objectContaining({ content: 'Fixed add.', stopReason: 'end_turn' }),
    ]);
  });

  it('reports a tool OpenCode saw fail as failed', async () => {
    const { session } = connect(async (turn) => {
      await turn.tool('bash', 'execute', { command: 'false' }, '', { fails: 'exit code 1' });
      turn.say('It failed.');
    });

    const events = await collectTurn(session, 'run false');

    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_result', ok: false, error: expect.objectContaining({ message: 'exit code 1' }) }));
  });

  it('runs the model and effort the person picked, and changes them only when they differ', async () => {
    const { opencode, session } = connect(async (turn) => turn.say(`${turn.session.model} ${turn.session.effort ?? '-'}`), {}, 'opencode/space-bunny-free');
    session.reasoning = { effort: 'medium' };

    const first = await collectTurn(session, 'which model?');
    const second = await collectTurn(session, 'again');

    expect(opencode.last.sent('session/set_config_option')).toEqual([
      { sessionId: 'ses_1', configId: 'model', value: 'opencode/space-bunny-free' },
      { sessionId: 'ses_1', configId: 'effort', value: 'medium' },
    ]);
    expect([...said(first), ...said(second)]).toEqual(['opencode/space-bunny-free medium', 'opencode/space-bunny-free medium']);
  });

  it('leaves the effort alone when the model offers no such level', async () => {
    const { opencode, session } = connect(async (turn) => turn.say('ok'));
    session.reasoning = { effort: 'medium' };

    await collectTurn(session, 'hi');

    expect(opencode.last.sent('session/set_config_option')).toEqual([]);
  });

  it('says so when OpenCode has no such model', async () => {
    const { session } = connect(async (turn) => turn.say('ok'), {}, 'openai/gpt-0');

    const events = await collectTurn(session, 'hi');

    expect(events).toContainEqual(expect.objectContaining({ type: 'error', kind: 'fatal', message: expect.stringContaining('openai/gpt-0') }));
  });

  it('hands OpenCode the person images with the message', async () => {
    const { opencode, session } = connect(async (turn) => turn.say(`${turn.prompt.length} parts`));

    await collectTurn(session, 'what is this?', {
      attachments: [{ kind: 'image', mediaType: 'image/png', content: 'iVBORw0KGgo=', name: 'shot.png' }],
    });

    const prompt = opencode.last.sent('session/prompt')[0]?.prompt;
    expect(prompt).toEqual(expect.arrayContaining([{ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' }]));
  });

  it('keeps the same OpenCode session for the next message of the conversation', async () => {
    const { opencode, session } = connect(async (turn) => turn.say(turn.text === 'first' ? 'one' : 'two'));

    await collectTurn(session, 'first');
    const second = await collectTurn(session, 'second');

    expect(opencode.servers).toHaveLength(1);
    expect(opencode.last.sent('session/new')).toHaveLength(1);
    expect(opencode.last.sent('session/prompt')).toHaveLength(2);
    expect(said(second)).toEqual(['two']);
  });

  it('loads the session in a new OpenCode when the old one was closed, without showing the history OpenCode replays', async () => {
    const { opencode, session, pool } = connect(async (turn) => turn.say(turn.text === 'remember MARMOT-55' ? 'noted' : 'MARMOT-55'));
    await collectTurn(session, 'remember MARMOT-55');
    await pool.close(String(session.id));

    const next = await collectTurn(session, 'which word?');

    expect(opencode.servers).toHaveLength(2);
    expect(opencode.servers[0]?.closed).toBe(true);
    expect(opencode.last.sent('session/load')[0]).toMatchObject({ sessionId: 'ses_1', cwd: '/work/app', mcpServers: [expect.objectContaining({ name: 'moxxy' })] });
    expect(opencode.last.sent('session/new')).toHaveLength(0);
    expect(said(next)).toEqual(['MARMOT-55']);
  });

  it('starts a new session when OpenCode no longer has the old one', async () => {
    const { opencode, session, pool } = connect(async (turn) => turn.say('ok'));
    await collectTurn(session, 'hello');
    await pool.close(String(session.id));
    opencode.saved.clear();

    const events = await collectTurn(session, 'hello again');

    expect(opencode.last.sent('session/new')).toHaveLength(1);
    expect(events).toContainEqual(expect.objectContaining({ type: 'plugin_event', subtype: 'agent_session', payload: { provider: 'opencode', sessionId: 'ses_2' } }));
  });
});

describe('approvals: OpenCode asks, Moxxy answers', () => {
  it('asks the person when OpenCode asks, and tells OpenCode the answer', async () => {
    let allowed: boolean | undefined;
    const { opencode, session } = connect(async (turn) => {
      ({ allowed } = await turn.tool('read', 'read', { filePath: '/elsewhere/notes.md' }, '# Notes', { title: '/elsewhere/notes.md', ask: true }));
      if (allowed) turn.say('Read it.');
    });
    session.setPermissionResolver(allowAll);

    const events = await collectTurn(session, 'read /elsewhere/notes.md');

    expect(allowed).toBe(true);
    expect(opencode.last.permissionAnswers).toEqual([{ outcome: { outcome: 'selected', optionId: 'once' } }]);
    const call = events.find((e) => e.type === 'tool_call_requested' && e.name === 'Read');
    if (call?.type !== 'tool_call_requested') throw new Error('expected the read to be shown');
    const order = events.filter((e) => 'callId' in e && e.callId === call.callId).map((e) => e.type);
    expect(order).toEqual(['tool_call_requested', 'tool_call_approved', 'tool_result']);
  });

  it('lets OpenCode remember an allow for the rest of the session when the person allows it for the session', async () => {
    const { opencode, session } = connect(async (turn) => {
      await turn.tool('bash', 'execute', { command: 'npm test' }, 'ok', { ask: true });
      turn.say('Done.');
    });
    session.setPermissionResolver(allowForSession);

    await collectTurn(session, 'test it');

    expect(opencode.last.permissionAnswers).toEqual([{ outcome: { outcome: 'selected', optionId: 'always' } }]);
  });

  it('refuses when the person declines, and gives OpenCode their reason in the same turn, since its answer carries none', async () => {
    const { opencode, session } = connect(async (turn) => {
      if (turn.text === 'build it') {
        await turn.tool('write', 'edit', { filePath: '/work/app/app.js', content: '' }, '', { ask: true });
        // OpenCode ends its turn after a refusal.
        return;
      }
      turn.say(`Understood: ${turn.text}`);
    });
    session.setPermissionResolver(personSays('not now, build it in goal mode'));

    const events = await collectTurn(session, 'build it');

    expect(opencode.last.permissionAnswers).toEqual([{ outcome: { outcome: 'selected', optionId: 'reject' } }]);
    const prompts = opencode.last.sent('session/prompt');
    expect(prompts).toHaveLength(2);
    expect(prompts[1]?.prompt).toEqual([{ type: 'text', text: expect.stringContaining('not now, build it in goal mode') }]);
    expect(said(events)[0]).toContain('Write');
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_call_denied', reason: 'not now, build it in goal mode' }));
  });

  it('stops sending the reason after a few refusals in one turn, and keeps it for the next message', async () => {
    const { opencode, session } = connect(async (turn) => {
      if (turn.text.endsWith('and now?')) return turn.say('ok');
      await turn.tool('bash', 'execute', { command: 'git push --force' }, '', { ask: true });
    });
    session.setPermissionResolver(personSays('no force pushes'));

    await collectTurn(session, 'push it');
    const sentInTurn = opencode.last.sent('session/prompt').length;
    await collectTurn(session, 'and now?');

    expect(sentInTurn).toBe(4);
    const next = opencode.last.sent('session/prompt').at(-1)?.prompt;
    expect(next).toEqual([{ type: 'text', text: expect.stringContaining('no force pushes') }, { type: 'text', text: 'and now?' }]);
  });

  it('answers OpenCode asks itself while auto-approve is on, but a standing deny rule still refuses', async () => {
    let asked = 0;
    const { opencode, session } = connect(async (turn) => {
      if (opencode.promptCount > 1) return turn.say('I will not.');
      await turn.tool('bash', 'execute', { command: 'npm test' }, 'ok', { ask: true });
      await turn.tool('bash', 'execute', { command: 'rm -rf /' }, '', { ask: true });
    });
    session.setPermissionResolver({
      name: 'person',
      check: async () => {
        asked += 1;
        return { mode: 'deny', reason: 'asked' };
      },
    });
    await session.permissions.addDeny({ name: 'Bash', inputMatches: { command: 'rm -rf' }, reason: 'never rm -rf' });
    await session.setAutoApprove(true);

    await collectTurn(session, 'test it');

    expect(asked).toBe(0);
    expect(opencode.last.permissionAnswers).toEqual([
      { outcome: { outcome: 'selected', optionId: 'once' } },
      { outcome: { outcome: 'selected', optionId: 'reject' } },
    ]);
  });

  it('leaves auto-approve off when OpenCode own rules ask before edits and commands', async () => {
    const { session, opencode } = connect(async (turn) => turn.say('ok'));

    await collectTurn(session, 'hi');

    expect(opencode.rulesRead).toEqual(['build']);
    expect(autoApproveFromEvents(session.log.ofType('plugin_event'))).toBe(false);
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
      turn.say('Opened.');
    });
    session.pluginHost.registerStatic(definePlugin({ name: 'test-browser', tools: [browserOpen] }));

    const events = await collectTurn(session, 'open the app');

    expect(ran).toBe(1);
    expect(lent).toMatchObject({ content: [{ type: 'text', text: 'opened http://localhost:8765' }] });
    expect(shownCalls(events).map((call) => call.name)).toEqual(['browser_open']);
  });
});

describe('auto-approve shows how OpenCode really runs', () => {
  const pushDenied = { build: [...OPENCODE_DEFAULT_RULES, { permission: 'bash', pattern: 'git push *', action: 'deny' as const }] };
  const autoApprove = (session: Session) => autoApproveFromEvents(session.log.ofType('plugin_event'));

  it('is on for a new conversation when OpenCode runs without asking, as it does on its defaults', async () => {
    const { session, opencode } = connect(async (turn) => turn.say('ok'), { rules: { build: OPENCODE_DEFAULT_RULES } });

    await collectTurn(session, 'hi');

    expect(autoApprove(session)).toBe(true);
    expect(opencode.servers).toHaveLength(1);
    expect(opencode.last.env.OPENCODE_CONFIG_CONTENT).toBeUndefined();
  });

  it('has OpenCode ask before changes once the person turns it off, keeping what OpenCode own rules deny', async () => {
    const asked: string[] = [];
    const { session, opencode } = connect(
      async (turn) => {
        if (opencode.promptCount === 1) return turn.say('ok');
        const write = await turn.tool('write', 'edit', { filePath: '/work/app/a.txt', content: 'x' }, 'Wrote file successfully.');
        const push = await turn.tool('bash', 'execute', { command: 'git push origin main' }, 'pushed');
        turn.say(`write ${write.allowed}, push ${push.allowed}`);
      },
      { rules: pushDenied },
    );
    session.setPermissionResolver({ name: 'person', check: async (call) => (asked.push(call.name), { mode: 'allow' }) });
    await collectTurn(session, 'hi');

    await session.setAutoApprove(false);
    const events = await collectTurn(session, 'write it');

    expect(opencode.servers).toHaveLength(2);
    expect(JSON.parse(String(opencode.last.env.OPENCODE_CONFIG_CONTENT))).toEqual({
      agent: { build: { permission: { edit: { '*': 'ask' }, bash: { '*': 'ask', 'git push *': 'deny' }, webfetch: 'ask', websearch: 'ask' } } },
    });
    expect(opencode.last.sent('session/load')).toEqual([expect.objectContaining({ sessionId: 'ses_1' })]);
    expect(asked).toEqual(['Write']);
    expect(shownCalls(events)[0]).toEqual({ name: 'Write', input: { file_path: '/work/app/a.txt', diff: expect.stringContaining('+x') } });
    expect(said(events)).toEqual(['write true, push false']);
    expect(autoApprove(session)).toBe(false);
  });

  it('answers OpenCode asks itself again once the person turns it back on, without starting OpenCode again', async () => {
    const asked: string[] = [];
    const { session, opencode } = connect(
      async (turn) => {
        if (opencode.promptCount === 1) return turn.say('ok');
        await turn.tool('write', 'edit', { filePath: '/work/app/a.txt', content: 'x' }, 'Wrote file successfully.');
        turn.say('written');
      },
      { rules: { build: OPENCODE_DEFAULT_RULES } },
    );
    session.setPermissionResolver({ name: 'person', check: async (call) => (asked.push(call.name), { mode: 'allow' }) });
    await collectTurn(session, 'hi');
    await session.setAutoApprove(false);
    await collectTurn(session, 'write it');

    await session.setAutoApprove(true);
    await collectTurn(session, 'write it again');

    expect(opencode.servers).toHaveLength(2);
    expect(opencode.last.permissionAnswers).toHaveLength(2);
    expect(asked).toEqual(['Write']);
  });

  it('still asks the person before OpenCode works outside the project while auto-approve turned itself on', async () => {
    const asked: string[] = [];
    const { session, opencode } = connect(
      async (turn) => {
        const write = await turn.tool('write', 'edit', { filePath: '/elsewhere/a.txt', content: 'x' }, 'Wrote file successfully.', { outside: '/elsewhere/a.txt' });
        const list = await turn.tool('bash', 'execute', { command: 'ls /elsewhere' }, 'a.txt', { outside: '/elsewhere' });
        const local = await turn.tool('write', 'edit', { filePath: '/work/app/b.txt', content: 'y' }, 'Wrote file successfully.');
        turn.say(`outside ${write.allowed} ${list.allowed}, local ${local.allowed}`);
      },
      { rules: { build: OPENCODE_DEFAULT_RULES } },
    );
    session.setPermissionResolver({ name: 'person', check: async (call) => (asked.push(call.name), { mode: 'allow' }) });

    const events = await collectTurn(session, 'write it');

    expect(autoApprove(session)).toBe(true);
    expect(asked).toHaveLength(2);
    expect(opencode.last.permissionAnswers).toHaveLength(2);
    expect(said(events)).toEqual(['outside true true, local true']);
  });

  it('answers those asks itself once the person chose auto-approve', async () => {
    const asked: string[] = [];
    const { session, opencode } = connect(
      async (turn) => {
        if (opencode.promptCount < 3) return turn.say('ok');
        await turn.tool('write', 'edit', { filePath: '/elsewhere/a.txt', content: 'x' }, 'Wrote file successfully.', { outside: '/elsewhere/a.txt' });
        turn.say('written');
      },
      { rules: { build: OPENCODE_DEFAULT_RULES } },
    );
    session.setPermissionResolver({ name: 'person', check: async (call) => (asked.push(call.name), { mode: 'allow' }) });
    await collectTurn(session, 'hi');
    await session.setAutoApprove(false);
    await collectTurn(session, 'hi again');
    await session.setAutoApprove(true);

    await collectTurn(session, 'write it');

    expect(asked).toEqual([]);
    expect(opencode.last.permissionAnswers.length).toBeGreaterThan(0);
  });

  it('keeps asking about outside the project on later messages while auto-approve is still the one OpenCode turned on', async () => {
    const asked: string[] = [];
    const { session } = connect(
      async (turn) => {
        await turn.tool('write', 'edit', { filePath: '/elsewhere/a.txt', content: 'x' }, 'Wrote file successfully.', { outside: '/elsewhere/a.txt' });
        turn.say('written');
      },
      { rules: { build: OPENCODE_DEFAULT_RULES } },
    );
    session.setPermissionResolver({ name: 'person', check: async (call) => (asked.push(call.name), { mode: 'allow' }) });
    await collectTurn(session, 'one');

    await collectTurn(session, 'two');

    expect(asked).toHaveLength(2);
  });

  it('leaves auto-approve and OpenCode as they are when OpenCode cannot say how it runs', async () => {
    const { session, opencode } = connect(async (turn) => turn.say('ok'), { rules: null });

    await collectTurn(session, 'hi');
    await session.setAutoApprove(false);
    await collectTurn(session, 'again');

    expect(autoApprove(session)).toBe(false);
    expect(opencode.servers).toHaveLength(1);
  });
});

describe('plan and goal mode', () => {
  const plan = {
    title: 'Fix add',
    objective: 'add returns the sum.',
    approach: 'Change the operator and cover it with a test.',
    steps: [{ id: 'P1', title: 'Fix the operator', outcome: 'add(2, 2) is 4', actions: ['Use a + b'] }],
    recommendedMode: 'goal',
    handoff: 'Apply P1.',
  };

  it('plans in OpenCode plan mode and shows the plan it submits through plan_complete in the Moxxy plan card', async () => {
    const { opencode, session } = connect(async (turn) => {
      if (turn.session.mode !== 'plan') return turn.say('Implemented.');
      await turn.tool('read', 'read', { filePath: '/work/app/math.js' }, 'a - b');
      await turn.callMoxxyTool('plan_complete', plan);
      turn.say('Plan submitted.');
    });
    session.pluginHost.registerStatic(planModePlugin);
    session.modes.setActive('plan');

    const planned = await collectTurn(session, 'plan the fix');
    session.modes.setActive('default');
    const done = await collectTurn(session, 'go');

    expect(opencode.last.sent('session/set_config_option')).toEqual([
      { sessionId: 'ses_1', configId: 'mode', value: 'plan' },
      { sessionId: 'ses_1', configId: 'mode', value: 'build' },
    ]);
    expect(planned).toContainEqual(expect.objectContaining({ type: 'plugin_event', subtype: 'plan_completed', payload: expect.objectContaining({ title: 'Fix add' }) }));
    expect(said(done)).toEqual(['Implemented.']);
  });

  it('has OpenCode, which reads the Moxxy tools once when the session opens, read them again when a turn brings others', async () => {
    const read: Array<ReadonlyArray<string>> = [];
    const { session } = connect(async (turn) => {
      read.push(turn.session.moxxyTools);
      if (turn.session.mode === 'plan') await turn.callMoxxyTool('plan_complete', plan);
      turn.say('ok');
    });
    session.pluginHost.registerStatic(planModePlugin);

    await collectTurn(session, 'hello');
    session.modes.setActive('plan');
    const planned = await collectTurn(session, 'plan the fix');

    expect(read[0]).not.toContain('plan_complete');
    expect(read[1]).toContain('plan_complete');
    expect(planned).toContainEqual(expect.objectContaining({ type: 'plugin_event', subtype: 'plan_completed' }));
  });

  it('works on a goal until OpenCode declares it met through goal_complete, then hands back the previous mode', async () => {
    const { opencode, session } = connect(async (turn) => {
      if (opencode.promptCount === 1) {
        await turn.tool('write', 'edit', { filePath: '/work/app/goal.txt', content: 'GOAL-DONE' }, 'Wrote file successfully.');
        return turn.say('goal.txt is written.');
      }
      await turn.callMoxxyTool('goal_complete', { summary: 'goal.txt says GOAL-DONE', evidence: ['cat goal.txt'] });
      turn.say('Done.');
    });
    session.pluginHost.registerStatic(goalModePlugin);
    session.modes.setActive('goal');

    const events = await collectTurn(session, 'goal.txt says GOAL-DONE');

    const prompts = opencode.last.sent('session/prompt');
    expect(prompts).toHaveLength(2);
    expect(prompts[1]?.prompt).toEqual([{ type: 'text', text: expect.stringContaining('goal_complete') }]);
    expect(events.some((e) => e.type === 'plugin_event' && e.subtype === 'goal_completed')).toBe(true);
    expect(session.modes.getActiveName()).toBe('default');
  });
});

describe('stopping and failing', () => {
  it('cancels the OpenCode prompt on Stop, and the next message works as usual', async () => {
    const controller = new AbortController();
    const { opencode, session } = connect(async (turn) => {
      if (turn.text === 'wait') {
        turn.server.update(turn.session, { sessionUpdate: 'tool_call', toolCallId: 'call_wait', title: 'bash', kind: 'execute', status: 'pending', rawInput: {} });
        turn.server.update(turn.session, { sessionUpdate: 'tool_call_update', toolCallId: 'call_wait', title: 'sleep 100', kind: 'execute', status: 'in_progress', rawInput: { command: 'sleep 100' } });
        controller.abort();
        await new Promise(() => undefined);
      }
      turn.say('back');
    });

    const stopped = await collectTurn(session, 'wait', { signal: controller.signal });
    const next = await collectTurn(session, 'again');

    expect(opencode.last.sent('session/cancel')).toEqual([{ sessionId: 'ses_1' }]);
    expect(stopped.map((e) => e.type)).toContain('abort');
    expect(stopped).toContainEqual(expect.objectContaining({ type: 'tool_result', callId: 'call_wait', ok: false }));
    expect(said(next)).toEqual(['back']);
  });

  it('answers an ask OpenCode is waiting on as cancelled when the person stops the turn', async () => {
    const controller = new AbortController();
    const { opencode, session } = connect(async (turn) => {
      await turn.tool('bash', 'execute', { command: 'npm publish' }, '', { ask: true });
    });
    session.setPermissionResolver({
      name: 'person',
      check: async () => {
        controller.abort();
        return new Promise(() => undefined);
      },
    });

    await collectTurn(session, 'publish', { signal: controller.signal });

    expect(opencode.last.permissionAnswers).toEqual([{ outcome: { outcome: 'cancelled' } }]);
  });

  it('tells the person to sign in again when OpenCode sign-in to a model provider expired', async () => {
    const { session } = connect(async () => ({ error: { code: -32603, message: 'Token refresh failed: 401' } }));

    const events = await collectTurn(session, 'hi');

    expect(events).toContainEqual(expect.objectContaining({ type: 'error', kind: 'fatal', message: expect.stringContaining('opencode auth login') }));
  });

  it('ends the turn when OpenCode stops, and starts OpenCode again for the next message', async () => {
    let calls = 0;
    const { opencode, session } = connect(async (turn) => {
      calls += 1;
      if (calls === 1) {
        turn.server.crash();
        await new Promise(() => undefined);
      }
      turn.say('fine now');
    });

    const failed = await collectTurn(session, 'hi');
    const next = await collectTurn(session, 'hi again');

    expect(failed).toContainEqual(expect.objectContaining({ type: 'error', kind: 'fatal', message: expect.stringContaining('OpenCode stopped') }));
    expect(opencode.servers).toHaveLength(2);
    expect(said(next)).toEqual(['fine now']);
  });
});

describe('one-off text calls', () => {
  it('asks OpenCode for plain text in a session of its own, without Moxxy tools', async () => {
    const opencode = new FakeOpenCode(async (turn) => turn.say(`summary of: ${turn.text}`));
    const provider = new AcpAgentProvider({ startAgent: opencode.start, cwd: '/work/app' });

    const out: string[] = [];
    for await (const event of provider.stream({
      model: 'opencode/big-pickle',
      system: 'Summarize.',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'A long conversation' }] }],
    })) {
      if (event.type === 'text_delta') out.push(event.delta);
    }

    expect(out.join('')).toBe('summary of: Summarize.\n\nA long conversation');
    expect(opencode.last.sent('session/new')[0]).toEqual({ cwd: '/work/app', mcpServers: [] });
    expect(opencode.last.closed).toBe(true);
  });
});
