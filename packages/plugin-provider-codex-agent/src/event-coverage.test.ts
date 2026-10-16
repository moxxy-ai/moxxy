/**
 * Everything `codex app-server` 0.155.1 can send — its generated protocol types,
 * listed in fixtures/ — checked against what Moxxy does with it. An item shows
 * in the chat or is left out on purpose, a notification is read or left alone
 * on purpose, a request always gets an answer. A newer Codex brings a new
 * fixture, and each kind it adds becomes a decision here instead of something
 * lost without a trace.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { PermissionResolver, ToolImage } from '@moxxy/sdk';
import { collectTurn, type Session } from '@moxxy/core';
import { createFakeSession } from '@moxxy/testing';
import { defaultModePlugin } from '@moxxy/mode-default';
import { AgentSessionPool } from '@moxxy/agent-connection-kit';
import { CodexAgentProvider } from './agent-provider.js';
import type { CodexAgentSession } from './codex-session.js';
import { FakeCodex, type CodexScene } from './fake-codex.testkit.js';
import { CODEX_ITEMS_LEFT_OUT } from './protocol.js';
import { TurnTranslator } from './translate.js';

interface CodexKinds {
  readonly items: ReadonlyArray<string>;
  readonly notifications: ReadonlyArray<string>;
  readonly requests: ReadonlyArray<string>;
}

const kinds = JSON.parse(readFileSync(new URL('./fixtures/codex-app-server-0.155.1.json', import.meta.url), 'utf8')) as CodexKinds;

/** One item of every kind, shaped as Codex 0.155.1 sends it once it ends. */
const ITEMS: Record<string, Record<string, unknown>> = {
  agentMessage: { text: 'Done.' },
  plan: { text: '1. Read the code' },
  reasoning: { summary: ['Looking at the files'], content: [] },
  commandExecution: { command: 'ls', cwd: '/work/app', status: 'completed', aggregatedOutput: 'a.txt', exitCode: 0 },
  fileChange: { status: 'completed', changes: [{ path: '/work/app/a.txt', kind: { type: 'add' }, diff: 'hi\n' }] },
  mcpToolCall: { server: 'docs', tool: 'search', status: 'completed', arguments: { q: 'x' }, result: { content: [] }, error: null },
  webSearch: { query: 'moxxy', action: { type: 'search', query: 'moxxy' } },
  imageView: { path: '/work/app/a.png' },
  sleep: { durationMs: 2000 },
  imageGeneration: { status: 'completed', revisedPrompt: 'A red cube', result: 'iVBORw0KGgo=', failure: null },
  dynamicToolCall: { namespace: null, tool: 'lookup', arguments: { id: 1 }, status: 'completed', contentItems: [{ type: 'inputText', text: 'found' }], success: true, durationMs: 5 },
  enteredReviewMode: { review: 'the current changes' },
  exitedReviewMode: { review: 'Looks fine.' },
  functionCallOutput: { name: 'lookup', namespace: null, output: 'found' },
  userMessage: { clientId: null, content: [{ type: 'text', text: 'hi', text_elements: [] }] },
  hookPrompt: { fragments: [{ text: 'Be brief.', hookRunId: 'h1' }] },
  contextCompaction: {},
  collabAgentToolCall: { tool: 'wait', status: 'completed', senderThreadId: 't0', receiverThreadIds: [], prompt: null, model: null },
  subAgentActivity: { kind: 'started', agentThreadId: 't1', agentPath: '/root/check' },
};

/**
 * What Moxxy does with each notification. Those it reads carry the turn's
 * content or the conversation's state; the rest it leaves alone, for the reason given.
 */
const SHOWN = 'shown in the chat';
const STATE = "kept as the conversation's state";
const NOTIFICATIONS: Record<string, string> = {
  'item/started': SHOWN,
  'item/completed': SHOWN,
  'item/agentMessage/delta': SHOWN,
  'item/reasoning/summaryTextDelta': SHOWN,
  'turn/plan/updated': SHOWN,
  'thread/tokenUsage/updated': SHOWN,
  'account/rateLimits/updated': SHOWN,
  error: SHOWN,
  'turn/started': STATE,
  'turn/completed': STATE,
  'thread/settings/updated': STATE,
  'thread/goal/updated': STATE,
  'thread/goal/cleared': STATE,
};
const LEFT_ALONE: ReadonlyArray<readonly [RegExp, string]> = [
  [/^item\/(plan\/delta|reasoning\/(textDelta|summaryPartAdded)|commandExecution\/(outputDelta|terminalInteraction)|fileChange\/(outputDelta|patchUpdated)|mcpToolCall\/progress)$/, 'the item shows whole once it ends'],
  [/^item\/autoApprovalReview\/|^autoApprovalReview\/|^guardianWarning$/, "Codex's own reviewer; the approvals it answers are Codex's"],
  [/^turn\/(diff\/updated|moderationMetadata)$/, 'each file change shows its own diff; moderation stays with Codex'],
  [/^thread\/realtime\//, 'voice sessions, which Moxxy does not start'],
  [/^thread\/(started|status\/changed|name\/updated|archived|unarchived|closed|deleted|compacted|reverted|queue\/changed|attachment\/updated|project\/updated|environment\/(connected|disconnected))$/, "the thread's housekeeping; Moxxy keeps its own record"],
  [/^(account\/(login\/completed|updated)|modelProvider\/authRecovery(Started|Completed))$/, 'sign-in, which Moxxy checks itself'],
  [/^(model\/(rerouted|safetyBuffering\/updated|verification)|rawResponse\/completed|rawResponseItem\/completed)$/, "the model's raw stream; the items carry what it did"],
  [/^(warning|configWarning|deprecationNotice|windows\/worldWritableWarning|windowsSandbox\/setupCompleted)$/, "notes about the person's Codex setup, for their own Codex"],
  [/^(mcpServer\/|app\/list\/updated|skills\/changed|serverRequest\/resolved)/, 'servers, apps and skills Codex keeps; its requests are answered as they come'],
  [/^(command\/exec\/outputDelta|process\/(exited|outputDelta)|fs\/changed|fuzzyFileSearch\/|project\/changed|remoteControl\/status\/changed|externalAgentConfig\/import\/|hook\/(started|completed))/, 'calls Moxxy does not make, or work whose result is an item'],
];

const sessions: Session[] = [];
const pools: AgentSessionPool<CodexAgentSession>[] = [];

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.closeAll()));
  await Promise.all(sessions.splice(0).map((session) => session.close()));
});

describe('every item Codex 0.155.1 can send', () => {
  it('has a sample here, so a kind a newer Codex adds needs a decision', () => {
    expect(Object.keys(ITEMS).sort()).toEqual([...kinds.items]);
  });

  it.each(kinds.items)('%s shows in the chat, or is left out on purpose', (type) => {
    const picture: ToolImage = { mediaType: 'image/png', base64: 'AAA' };
    const events = new TurnTranslator('/work/app', () => picture).translate('item/completed', { item: { type, id: `item-${type}`, ...ITEMS[type] } });

    if (type in CODEX_ITEMS_LEFT_OUT) expect(events).toEqual([]);
    else expect(events.length).toBeGreaterThan(0);
  });
});

describe('every notification Codex 0.155.1 can send', () => {
  it.each(kinds.notifications)('%s is read, or left alone for a reason', (method) => {
    const reasons = [NOTIFICATIONS[method], ...LEFT_ALONE.filter(([pattern]) => pattern.test(method)).map(([, reason]) => reason)].filter(Boolean);

    expect(reasons).toHaveLength(1);
  });
});

describe('every request Codex 0.155.1 can make', () => {
  const allowAll: PermissionResolver = { name: 'allow-all', check: async () => ({ mode: 'allow' }) };
  const PARAMS: Record<string, Record<string, unknown>> = {
    'item/commandExecution/requestApproval': { itemId: 'c1', command: 'ls', cwd: '/work/app' },
    'item/fileChange/requestApproval': { itemId: 'f1' },
    'item/permissions/requestApproval': { itemId: 'p1', permissions: { network: { enabled: true } } },
    'item/tool/requestUserInput': { itemId: 'q1', questions: [] },
    'mcpServer/elicitation/request': { serverName: 'moxxy', message: 'Go ahead?' },
  };

  it('gets an answer, so Codex never waits on Moxxy', async () => {
    const answers: Record<string, 'answered' | 'refused'> = {};
    const scene: CodexScene = async (turn) => {
      for (const method of kinds.requests) {
        answers[method] = await turn.request(method, PARAMS[method] ?? {}).then(
          () => 'answered' as const,
          () => 'refused' as const,
        );
      }
      turn.say('Done.');
    };
    const pool = new AgentSessionPool<CodexAgentSession>({ limit: 1 });
    pools.push(pool);
    const codex = new FakeCodex(scene);
    const session = createFakeSession({ provider: new CodexAgentProvider({ startAppServer: codex.start, sessions: pool }), cwd: '/work/app' });
    sessions.push(session);
    session.pluginHost.registerStatic(defaultModePlugin);
    session.setPermissionResolver(allowAll);

    await collectTurn(session, 'Go');

    expect(Object.keys(answers).sort()).toEqual([...kinds.requests]);
    for (const method of Object.keys(PARAMS)) expect(answers[method]).toBe('answered');
  });
});

describe('an item kind Moxxy does not know', () => {
  it('shows as a call named after it, with what Codex said of it', () => {
    const translator = new TurnTranslator();
    const started = translator.translate('item/started', { item: { type: 'boardUpdate', id: 'b1', status: 'inProgress', board: 'Sprint 4' } });
    const ended = translator.translate('item/completed', { item: { type: 'boardUpdate', id: 'b1', status: 'completed', board: 'Sprint 4', moved: 3 } });

    expect(started).toEqual([{ type: 'tool_call', callId: 'b1', name: 'boardUpdate', input: { board: 'Sprint 4' } }]);
    expect(ended).toEqual([{ type: 'tool_result', callId: 'b1', ok: true, output: { moved: 3 } }]);
  });

  it('shows as failed when Codex says it failed', () => {
    const [, result] = new TurnTranslator().translate('item/completed', { item: { type: 'boardUpdate', id: 'b2', status: 'failed', board: 'Sprint 4' } });

    expect(result).toMatchObject({ type: 'tool_result', callId: 'b2', ok: false });
  });
});

describe("Codex's own pauses and pictures", () => {
  it('show a pause as a Sleep, like Moxxy\'s own', () => {
    expect(new TurnTranslator().translate('item/completed', { item: { type: 'sleep', id: 's1', durationMs: 2000 } })).toEqual([
      { type: 'tool_call', callId: 's1', name: 'Sleep', input: { ms: 2000 } },
      { type: 'tool_result', callId: 's1', ok: true, output: 'Waited 2 s.' },
    ]);
  });

  it('show the picture Codex generated, from the file it saved or from what it sent', () => {
    const saved: ToolImage = { mediaType: 'image/png', base64: 'SAVED' };
    const fromFile = new TurnTranslator('/work/app', (path) => (path === '/work/app/cube.png' ? saved : undefined)).translate('item/completed', {
      item: { type: 'imageGeneration', id: 'g1', status: 'completed', revisedPrompt: 'A red cube', result: 'SENT', failure: null, savedPath: '/work/app/cube.png' },
    });
    const sent = new TurnTranslator().translate('item/completed', {
      item: { type: 'imageGeneration', id: 'g2', status: 'completed', revisedPrompt: null, result: 'SENT', failure: null },
    });

    expect(fromFile[0]).toEqual({ type: 'tool_call', callId: 'g1', name: 'image_generation', input: { prompt: 'A red cube' } });
    expect(fromFile[1]).toMatchObject({ ok: true, output: { forModel: expect.stringContaining('/work/app/cube.png'), mediaType: 'image/png', base64: 'SAVED' } });
    expect(sent[1]).toMatchObject({ ok: true, output: { mediaType: 'image/png', base64: 'SENT' } });
  });

  it('say why a picture could not be made', () => {
    const [, result] = new TurnTranslator().translate('item/completed', {
      item: { type: 'imageGeneration', id: 'g3', status: 'failed', revisedPrompt: null, result: '', failure: { type: 'usageLimitExceeded', limitId: 'images', resetsAt: null } },
    });

    expect(result).toEqual({ type: 'tool_result', callId: 'g3', ok: false, error: 'Codex has used up its limit for pictures.' });
  });
});
