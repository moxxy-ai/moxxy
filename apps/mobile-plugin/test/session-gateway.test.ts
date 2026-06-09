import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createMobileGatewayServer, mobileGatewayPlugin } from '../serve.js';

describe('session-backed mobile gateway', () => {
  it('exposes the real session snapshot without fixture asks or messages', async () => {
    const session = createFakeSession();
    const gateway = await createMobileGatewayServer({ session, port: 0 }).start();
    try {
      const pairing = await getJson<{ code: string }>(`${gateway.url}/mobile/v1/pairing`);
      const paired = await postJson<{ token: string }>(`${gateway.url}/mobile/v1/pair`, { code: pairing.code });
      const snapshot = await getJson<Record<string, unknown>>(`${gateway.url}/mobile/v1/snapshot`, paired.token);

      expect(snapshot).toMatchObject({
        session: { id: 'session-real' },
        activeProvider: 'openai-codex',
        activeMode: 'developer',
        pendingPermissions: [],
        pendingAsks: [],
        chatEvents: [],
      });
      expect(snapshot).not.toMatchObject({
        pendingPermissions: [{ id: 'perm-1' }],
        pendingAsks: [{ requestId: 'ask-1' }],
      });
    } finally {
      await gateway.stop();
    }
  });

  it('runs chat turns through session.runTurn and broadcasts real log events', async () => {
    const session = createFakeSession();
    const gateway = await createMobileGatewayServer({ session, port: 0 }).start();
    try {
      const pairing = await getJson<{ code: string }>(`${gateway.url}/mobile/v1/pairing`);
      const paired = await postJson<{ token: string }>(`${gateway.url}/mobile/v1/pair`, { code: pairing.code });
      const socket = new WebSocket(`${gateway.wsUrl}/mobile/v1/ws?token=${paired.token}`);
      const messages = collectMessages(socket);
      await waitForFrame(messages, 'snapshot');

      socket.send(JSON.stringify({ type: 'runTurn', id: 'mobile-run-1', prompt: 'czesc' }));

      await expect(waitForEvent(messages, 'user_prompt')).resolves.toMatchObject({
        type: 'event',
        event: { type: 'user_prompt', text: 'czesc' },
      });
      await expect(waitForEvent(messages, 'assistant_message')).resolves.toMatchObject({
        type: 'event',
        event: { type: 'assistant_message', content: 'real answer: czesc' },
      });
      expect(session.prompts).toEqual(['czesc']);
      socket.close();
    } finally {
      await gateway.stop();
    }
  });

  it('keeps in-flight turn events attached to the session that started the turn', async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), 'moxxy-mobile-gateway-isolated-sessions-'));
    const session = createControlledTurnSession();
    await writePersistedSession(sessionDir, 'session-other', [
      { type: 'user_prompt', text: 'other question' },
      { type: 'assistant_message', content: 'other answer' },
    ], {
      firstPrompt: 'Other session',
    });
    const gateway = await createMobileGatewayServer({ session, port: 0, sessionDir }).start();
    try {
      const pairing = await getJson<{ code: string }>(`${gateway.url}/mobile/v1/pairing`);
      const paired = await postJson<{ token: string }>(`${gateway.url}/mobile/v1/pair`, { code: pairing.code });
      const socket = new WebSocket(`${gateway.wsUrl}/mobile/v1/ws?token=${paired.token}`);
      const messages = collectMessages(socket);
      await waitForFrame(messages, 'snapshot');

      socket.send(JSON.stringify({ type: 'runTurn', id: 'live-turn', prompt: 'recipe question' }));
      await waitForEvent(messages, 'user_prompt', 'recipe question');

      socket.send(JSON.stringify({ type: 'selectSession', id: 'select-other', sessionId: 'session-other' }));
      await waitForSnapshot(messages, 'session-other');

      const afterSelectMessageCount = messages.length;
      session.releaseAssistant();
      await session.assistantEmitted;
      await waitForSnapshotAfter(messages, afterSelectMessageCount, 'session-other', (snapshot) =>
        Array.isArray(snapshot.chatEvents) &&
        snapshot.chatEvents.some((event) => (event as { content?: unknown }).content === 'other answer'),
      );

      const selectedOther = latestSnapshotFor(messages.slice(afterSelectMessageCount), 'session-other');
      expect(selectedOther?.chatEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'user_prompt', text: 'other question' }),
        expect.objectContaining({ type: 'assistant_message', content: 'other answer' }),
      ]));
      expect(selectedOther?.chatEvents).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'assistant_message', content: 'real answer: recipe question' }),
      ]));

      const beforeSelectLiveCount = messages.length;
      socket.send(JSON.stringify({ type: 'selectSession', id: 'select-live', sessionId: 'session-real' }));
      await waitForSnapshotAfter(messages, beforeSelectLiveCount, 'session-real', (snapshot) =>
        Array.isArray(snapshot.chatEvents) &&
        snapshot.chatEvents.some((event) => (event as { content?: unknown }).content === 'real answer: recipe question'),
      );
      socket.close();
    } finally {
      await gateway.stop();
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it('transcribes mobile voice clips through the session transcriber and returns transcript text', async () => {
    const session = createFakeSession();
    const gateway = await createMobileGatewayServer({ session, port: 0 }).start();
    try {
      const pairing = await getJson<{ code: string }>(`${gateway.url}/mobile/v1/pairing`);
      const paired = await postJson<{ token: string }>(`${gateway.url}/mobile/v1/pair`, { code: pairing.code });
      const socket = new WebSocket(`${gateway.wsUrl}/mobile/v1/ws?token=${paired.token}`);
      const messages = collectMessages(socket);
      await waitForFrame(messages, 'snapshot');

      socket.send(JSON.stringify({
        type: 'transcribe',
        id: 'voice-1',
        audioBase64: Buffer.from([1, 2, 3, 4]).toString('base64'),
        mimeType: 'audio/m4a',
      }));

      await expect(waitForFrame(messages, 'transcribe.result')).resolves.toMatchObject({
        type: 'transcribe.result',
        id: 'voice-1',
        text: 'nagrany tekst',
      });
      expect(session.transcriptions).toEqual([
        { bytes: [1, 2, 3, 4], mimeType: 'audio/m4a' },
      ]);
      socket.close();
    } finally {
      await gateway.stop();
    }
  });

  it('lists and runs workflows through the real session workflow view', async () => {
    const session = createFakeSession();
    const gateway = await createMobileGatewayServer({ session, port: 0 }).start();
    try {
      const pairing = await getJson<{ code: string }>(`${gateway.url}/mobile/v1/pairing`);
      const paired = await postJson<{ token: string }>(`${gateway.url}/mobile/v1/pair`, { code: pairing.code });
      const socket = new WebSocket(`${gateway.wsUrl}/mobile/v1/ws?token=${paired.token}`);
      const messages = collectMessages(socket);
      await waitForFrame(messages, 'snapshot');

      socket.send(JSON.stringify({ type: 'workflow.list', id: 'workflow-list-1' }));

      const listed = await waitForSnapshotWithWorkflow(messages, 'codzienny-obrazek-email');
      expect(listed.snapshot.workflows).toEqual([
        expect.objectContaining({
          name: 'codzienny-obrazek-email',
          description: 'Send the daily image email',
          enabled: true,
          steps: 3,
        }),
        expect.objectContaining({ name: 'daily-summary', enabled: false }),
      ]);

      socket.send(JSON.stringify({ type: 'workflow.run', id: 'workflow-run-1', name: 'daily-summary' }));

      await expect(waitForConnection(messages, 'workflow.run.completed')).resolves.toMatchObject({
        type: 'connection',
        status: 'workflow.run.completed',
        id: 'workflow-run-1',
      });
      await expect(waitForEvent(messages, 'workflow_run')).resolves.toMatchObject({
        type: 'event',
        event: {
          type: 'workflow_run',
          name: 'daily-summary',
          result: expect.objectContaining({ ok: true, output: 'ran daily-summary' }),
        },
      });
      expect(session.workflowRuns).toEqual(['daily-summary']);
      socket.close();
    } finally {
      await gateway.stop();
    }
  });

  it('lists persisted sessions and resumes the selected session for new turns', async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), 'moxxy-mobile-gateway-sessions-'));
    const session = createFakeSession();
    await writePersistedSession(sessionDir, 'session-old', [
      { type: 'user_prompt', text: 'old question' },
      { type: 'assistant_message', content: 'old answer' },
    ]);
    await writePersistedSession(sessionDir, 'empty-archive', [], { firstPrompt: null });
    const gateway = await createMobileGatewayServer({ session, port: 0, sessionDir }).start();
    try {
      const pairing = await getJson<{ code: string }>(`${gateway.url}/mobile/v1/pairing`);
      const paired = await postJson<{ token: string }>(`${gateway.url}/mobile/v1/pair`, { code: pairing.code });
      const snapshot = await getJson<Record<string, unknown>>(`${gateway.url}/mobile/v1/snapshot`, paired.token);

      expect(snapshot.sessions).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'session-real', live: true, readOnly: false }),
        expect.objectContaining({
          id: 'session-old',
          live: false,
          readOnly: true,
          firstPrompt: 'Archived work',
          eventCount: 2,
        }),
      ]));
      expect((snapshot.sessions as Array<{ id: string }>).map((item) => item.id)).not.toContain('empty-archive');

      const socket = new WebSocket(`${gateway.wsUrl}/mobile/v1/ws?token=${paired.token}`);
      const messages = collectMessages(socket);
      await waitForFrame(messages, 'snapshot');

      socket.send(JSON.stringify({ type: 'selectSession', id: 'select-old', sessionId: 'session-old' }));

      const selected = await waitForSnapshot(messages, 'session-old');
      expect(selected.snapshot).toMatchObject({
        activeWorkspaceId: 'session-old',
        session: { id: 'session-old', readOnly: false },
        chatEvents: [
          { type: 'user_prompt', text: 'old question' },
          { type: 'assistant_message', content: 'old answer' },
        ],
        activeMode: 'developer',
      });

      socket.send(JSON.stringify({ type: 'runTurn', id: 'run-resumed', prompt: 'continue old' }));
      await expect(waitForEvent(messages, 'user_prompt', 'continue old')).resolves.toMatchObject({
        type: 'event',
        event: { type: 'user_prompt', text: 'continue old' },
      });
      await expect(waitForEvent(messages, 'assistant_message', 'real answer: continue old')).resolves.toMatchObject({
        type: 'event',
        event: { type: 'assistant_message', content: 'real answer: continue old' },
      });
      expect(session.prompts).toEqual(['continue old']);
      expect(session.contextsBeforeTurn[0]).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'user_prompt', text: 'old question' }),
        expect.objectContaining({ type: 'assistant_message', content: 'old answer' }),
      ]));
      await waitFor(async () => {
        const events = await readPersistedSession(sessionDir, 'session-old');
        return events.some((event) => event.type === 'assistant_message' && event.content === 'real answer: continue old');
      });
      const persistedEvents = await readPersistedSession(sessionDir, 'session-old');
      expect(persistedEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'user_prompt', text: 'continue old', sessionId: 'session-old', seq: 2 }),
        expect.objectContaining({ type: 'assistant_message', content: 'real answer: continue old', sessionId: 'session-old', seq: 3 }),
      ]));
      const meta = JSON.parse(await readFile(join(sessionDir, 'session-old.meta.json'), 'utf8')) as { eventCount: number };
      expect(meta.eventCount).toBe(4);
      socket.close();
    } finally {
      await gateway.stop();
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it('orders mobile sessions by latest activity instead of pinning the live session first', async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), 'moxxy-mobile-gateway-sessions-'));
    const session = createFakeSession();
    session.log.ingest({
      id: 'live-old',
      seq: 0,
      ts: '2026-06-08T09:00:00.000Z',
      sessionId: 'session-real',
      turnId: 'turn-live',
      source: 'user',
      type: 'user_prompt',
      text: 'older live prompt',
    });
    await writePersistedSession(
      sessionDir,
      'session-newer',
      [
        {
          id: 'newer-prompt',
          seq: 0,
          ts: '2026-06-09T10:00:00.000Z',
          sessionId: 'session-newer',
          turnId: 'turn-newer',
          source: 'user',
          type: 'user_prompt',
          text: 'newer archive prompt',
        },
      ],
      { firstPrompt: 'Newer archive', lastActivity: '2026-06-09T10:00:00.000Z' },
    );

    const gateway = await createMobileGatewayServer({ session, port: 0, sessionDir }).start();
    try {
      const pairing = await getJson<{ code: string }>(`${gateway.url}/mobile/v1/pairing`);
      const paired = await postJson<{ token: string }>(`${gateway.url}/mobile/v1/pair`, { code: pairing.code });
      const snapshot = await getJson<{ sessions: Array<{ id: string }> }>(`${gateway.url}/mobile/v1/snapshot`, paired.token);

      expect(snapshot.sessions.map((item) => item.id).slice(0, 2)).toEqual(['session-newer', 'session-real']);
    } finally {
      await gateway.stop();
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it('annotates mobile sessions with desktop workspace metadata by cwd', async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), 'moxxy-mobile-gateway-workspace-sessions-'));
    const session = createFakeSession();
    await writePersistedSession(sessionDir, 'session-workspace', [
      { type: 'user_prompt', text: 'workspace question', ts: '2026-06-09T10:00:00.000Z' },
    ], {
      firstPrompt: 'Workspace question',
      cwd: '/Users/kamil/new_moxxy',
      lastActivity: '2026-06-09T10:00:00.000Z',
    });
    const gateway = await createMobileGatewayServer({
      session,
      port: 0,
      sessionDir,
      workspaceCatalog: {
        resolve: (cwd: string) => ({
          id: cwd === '/Users/kamil/new_moxxy' ? 'desk-new-moxxy' : `workspace:${cwd}`,
          name: cwd === '/Users/kamil/new_moxxy' ? 'new_moxxy' : 'other',
          cwd,
          color: cwd === '/Users/kamil/new_moxxy' ? '#ec4899' : '#64748b',
        }),
      },
    }).start();
    try {
      const pairing = await getJson<{ code: string }>(`${gateway.url}/mobile/v1/pairing`);
      const paired = await postJson<{ token: string }>(`${gateway.url}/mobile/v1/pair`, { code: pairing.code });
      const snapshot = await getJson<{ sessions: Array<Record<string, unknown>> }>(`${gateway.url}/mobile/v1/snapshot`, paired.token);

      expect(snapshot.sessions.find((item) => item.id === 'session-workspace')).toMatchObject({
        workspaceId: 'desk-new-moxxy',
        workspaceName: 'new_moxxy',
        workspaceColor: '#ec4899',
      });
    } finally {
      await gateway.stop();
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it('exposes real desktop workspaces and hydrates their desktop chat logs', async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), 'moxxy-mobile-gateway-real-workspaces-sessions-'));
    const desktopChatDir = await mkdtemp(join(tmpdir(), 'moxxy-mobile-gateway-real-workspaces-chats-'));
    const session = createFakeSession();
    await writePersistedSession(sessionDir, 'session-moxxy', [
      { type: 'user_prompt', text: 'moxxy session', ts: '2026-06-09T10:00:00.000Z' },
    ], {
      firstPrompt: 'Moxxy session',
      cwd: '/Users/kamil/Downloads/moxxy workspace',
      lastActivity: '2026-06-09T10:00:00.000Z',
    });
    await writePersistedSession(sessionDir, 'session-other', [
      { type: 'user_prompt', text: 'other session', ts: '2026-06-09T09:00:00.000Z' },
    ], {
      firstPrompt: 'Other session',
      cwd: '/Users/kamil/new_moxxy',
      lastActivity: '2026-06-09T09:00:00.000Z',
    });
    await writeDesktopChat(desktopChatDir, 'desk-tata', [
      { type: 'user_prompt', text: 'tata question', ts: '2026-06-09T08:00:00.000Z' },
      { type: 'assistant_message', content: 'tata answer', ts: '2026-06-09T08:01:00.000Z' },
    ]);
    const workspaceCatalog = {
      list: () => [
        {
          id: 'desk-moxxy',
          name: 'moxxy workspace',
          cwd: '/Users/kamil/Downloads/moxxy workspace',
          color: '#3b82f6',
        },
        {
          id: 'desk-tata',
          name: 'Tata',
          cwd: '/Users/kamil/Downloads/Tata',
          color: '#ef4444',
        },
      ],
      resolve: (cwd: string) =>
        workspaceCatalog.list().find((workspace) => workspace.cwd === cwd) ?? null,
    };
    const gateway = await createMobileGatewayServer({
      session,
      port: 0,
      sessionDir,
      desktopChatDir,
      workspaceCatalog,
    }).start();
    try {
      const pairing = await getJson<{ code: string }>(`${gateway.url}/mobile/v1/pairing`);
      const paired = await postJson<{ token: string }>(`${gateway.url}/mobile/v1/pair`, { code: pairing.code });
      const snapshot = await getJson<{
        workspaces: Array<Record<string, unknown>>;
        sessions: Array<Record<string, unknown>>;
      }>(`${gateway.url}/mobile/v1/snapshot`, paired.token);

      expect(snapshot.workspaces.map((workspace) => workspace.name)).toEqual(['moxxy workspace', 'Tata']);
      expect(snapshot.sessions.find((item) => item.id === 'session-moxxy')).toMatchObject({
        workspaceId: 'desk-moxxy',
        workspaceName: 'moxxy workspace',
      });
      expect(snapshot.sessions.find((item) => item.id === 'session-other')).toMatchObject({
        workspaceId: 'others',
        workspaceName: 'Others',
      });
      expect(snapshot.sessions.find((item) => item.id === 'desk-tata')).toMatchObject({
        workspaceId: 'desk-tata',
        workspaceName: 'Tata',
        firstPrompt: 'tata question',
      });
      expect(snapshot.sessions.map((item) => item.workspaceId)).not.toContain('workspace:/Users/kamil/new_moxxy');

      const socket = new WebSocket(`${gateway.wsUrl}/mobile/v1/ws?token=${paired.token}`);
      const messages = collectMessages(socket);
      await waitForFrame(messages, 'snapshot');

      socket.send(JSON.stringify({ type: 'selectSession', id: 'select-tata', sessionId: 'desk-tata' }));

      const selected = await waitForSnapshot(messages, 'desk-tata');
      expect(selected.snapshot).toMatchObject({
        activeWorkspaceId: 'desk-tata',
        session: { id: 'desk-tata', readOnly: false },
        chatEvents: [
          { type: 'user_prompt', text: 'tata question' },
          { type: 'assistant_message', content: 'tata answer' },
        ],
      });
      socket.close();
    } finally {
      await gateway.stop();
      await rm(sessionDir, { recursive: true, force: true });
      await rm(desktopChatDir, { recursive: true, force: true });
    }
  });
});

describe('mobile channel launcher', () => {
  it('routes the interactive open subcommand through the real channel start path', async () => {
    const open = mobileGatewayPlugin.channels[0]?.subcommands?.open;
    let startedWith: Record<string, unknown> | null = null;

    const result = await open?.run({
      deps: {},
      args: { positional: [], flags: { port: '17902' } },
      session: createFakeSession(),
      startChannel: async (options: Record<string, unknown>) => {
        startedWith = { ...options };
        return 0;
      },
    });

    expect(result).toBe(0);
    expect(startedWith).toMatchObject({
      port: '17902',
      __skipWizard: true,
    });
  });
});

function createFakeSession() {
  const events: Array<Record<string, unknown>> = [];
  const listeners = new Set<(event: Record<string, unknown>) => void>();
  let activeTranscriber: string | null = null;
  const session = {
    id: 'session-real',
    cwd: '/repo/real',
    prompts: [] as string[],
    contextsBeforeTurn: [] as Array<Array<Record<string, unknown>>>,
    transcriptions: [] as Array<{ bytes: number[]; mimeType?: string }>,
    workflowRuns: [] as string[],
    log: {
      length: 0,
      slice: () => [...events],
      clear: () => {
        events.splice(0, events.length);
        session.log.length = 0;
      },
      ingest: (event: Record<string, unknown>) => {
        events.push(event);
        session.log.length = events.length;
        for (const listener of listeners) listener(event);
      },
      subscribe: (listener: (event: Record<string, unknown>) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    getInfo: () => ({
      sessionId: 'session-real',
      cwd: '/repo/real',
      activeProvider: 'openai-codex',
      activeMode: 'developer',
      activeModeBadge: { label: 'DEV' },
      commands: [{ name: 'compact', description: 'Compact context' }],
      providers: [],
      modes: ['developer'],
      tools: [],
      skills: [],
      readyProviders: ['openai-codex'],
      hasTranscriber: true,
      activeTranscriber,
      hasSynthesizer: false,
      activeSynthesizer: null,
    }),
    transcribers: {
      getActiveName: () => activeTranscriber,
      has: (name: string) => name === 'openai-codex-transcribe',
      list: () => [{ name: 'openai-codex-transcribe' }],
      getActive: () => transcriber,
      tryGetActive: () => (activeTranscriber ? transcriber : null),
      setActive: (name: string) => {
        activeTranscriber = name;
        return transcriber;
      },
    },
    workflows: {
      list: async () => [
        {
          name: 'codzienny-obrazek-email',
          description: 'Send the daily image email',
          enabled: true,
          scope: 'project',
          steps: 3,
          triggers: 'manual',
        },
        {
          name: 'daily-summary',
          description: 'Summarize today',
          enabled: false,
          scope: 'user',
          steps: 2,
          triggers: 'manual',
        },
      ],
      setEnabled: async () => undefined,
      run: async (name: string) => {
        session.workflowRuns.push(name);
        return { ok: true, output: `ran ${name}`, steps: [] };
      },
    },
    async *runTurn(prompt: string) {
      session.contextsBeforeTurn.push([...events]);
      session.prompts.push(prompt);
      yield emit({ type: 'user_prompt', text: prompt });
      yield emit({ type: 'assistant_message', content: `real answer: ${prompt}`, stopReason: 'end_turn' });
    },
    setApprovalResolver: () => undefined,
  };

  const transcriber = {
    name: 'openai-codex-transcribe',
    transcribe: async (audio: Uint8Array, opts?: { mimeType?: string }) => {
      session.transcriptions.push({ bytes: [...audio], mimeType: opts?.mimeType });
      return { text: 'nagrany tekst' };
    },
  };

  function emit(event: Record<string, unknown>) {
    const next = {
      id: `event-${events.length}`,
      seq: events.length,
      ts: Date.now(),
      sessionId: 'session-real',
      turnId: 'turn-real',
      source: event.type === 'user_prompt' ? 'user' : 'model',
      ...event,
    };
    events.push(next);
    session.log.length = events.length;
    for (const listener of listeners) listener(next);
    return next;
  }

  return session;
}

function createControlledTurnSession() {
  const session = createFakeSession();
  let releaseAssistant!: () => void;
  let resolveAssistantEmitted!: () => void;
  const assistantGate = new Promise<void>((resolve) => {
    releaseAssistant = resolve;
  });
  const assistantEmitted = new Promise<void>((resolve) => {
    resolveAssistantEmitted = resolve;
  });

  session.runTurn = async function* runControlledTurn(prompt: string) {
    session.contextsBeforeTurn.push(session.log.slice());
    session.prompts.push(prompt);
    const user = controlledEvent(session, {
      type: 'user_prompt',
      text: prompt,
      source: 'user',
    });
    session.log.ingest(user);
    yield user;
    await assistantGate;
    const assistant = controlledEvent(session, {
      type: 'assistant_message',
      content: `real answer: ${prompt}`,
      source: 'model',
      stopReason: 'end_turn',
    });
    session.log.ingest(assistant);
    resolveAssistantEmitted();
    yield assistant;
  };

  return Object.assign(session, {
    releaseAssistant,
    assistantEmitted,
  });
}

function controlledEvent(
  session: ReturnType<typeof createFakeSession>,
  event: Record<string, unknown> & { readonly source: string },
) {
  const seq = session.log.length;
  return {
    id: `controlled-${seq}`,
    seq,
    ts: Date.now(),
    sessionId: 'session-real',
    turnId: 'turn-controlled',
    ...event,
  };
}

function collectMessages(socket: WebSocket): unknown[] {
  const messages: unknown[] = [];
  socket.on('message', (data) => messages.push(JSON.parse(String(data))));
  return messages;
}

async function waitForFrame(messages: unknown[], type: string): Promise<unknown> {
  await waitFor(() => messages.some((message) => (message as { type?: string }).type === type));
  return messages.find((message) => (message as { type?: string }).type === type);
}

async function waitForConnection(messages: unknown[], status: string): Promise<unknown> {
  await waitFor(() =>
    messages.some((message) => {
      const frame = message as { type?: string; status?: string };
      return frame.type === 'connection' && frame.status === status;
    }),
  );
  return messages.find((message) => {
    const frame = message as { type?: string; status?: string };
    return frame.type === 'connection' && frame.status === status;
  });
}

async function waitForEvent(messages: unknown[], eventType: string, text?: string): Promise<unknown> {
  await waitFor(() =>
    messages.some((message) => {
      const frame = message as { type?: string; event?: { type?: string } };
      return frame.type === 'event' && frame.event?.type === eventType && eventMatchesText(frame.event, text);
    }),
  );
  return messages.find((message) => {
    const frame = message as { type?: string; event?: { type?: string } };
    return frame.type === 'event' && frame.event?.type === eventType && eventMatchesText(frame.event, text);
  });
}

function eventMatchesText(event: { type?: string }, text?: string): boolean {
  if (typeof text !== 'string') return true;
  const value = event as { text?: unknown; content?: unknown; message?: unknown };
  return value.text === text || value.content === text || value.message === text;
}

async function waitForSnapshotWithWorkflow(messages: unknown[], workflowName: string): Promise<{ snapshot: Record<string, unknown> }> {
  await waitFor(() =>
    messages.some((message) => {
      const frame = message as { type?: string; snapshot?: { workflows?: Array<{ name?: string }> } };
      return frame.type === 'snapshot' && frame.snapshot?.workflows?.some((workflow) => workflow.name === workflowName);
    }),
  );
  return messages.find((message) => {
    const frame = message as { type?: string; snapshot?: { workflows?: Array<{ name?: string }> } };
    return frame.type === 'snapshot' && frame.snapshot?.workflows?.some((workflow) => workflow.name === workflowName);
  }) as { snapshot: Record<string, unknown> };
}

async function waitForSnapshot(messages: unknown[], activeWorkspaceId: string): Promise<{ snapshot: Record<string, unknown> }> {
  await waitFor(() =>
    messages.some((message) => {
      const frame = message as { type?: string; snapshot?: { activeWorkspaceId?: string } };
      return frame.type === 'snapshot' && frame.snapshot?.activeWorkspaceId === activeWorkspaceId;
    }),
  );
  return messages.find((message) => {
    const frame = message as { type?: string; snapshot?: { activeWorkspaceId?: string } };
    return frame.type === 'snapshot' && frame.snapshot?.activeWorkspaceId === activeWorkspaceId;
  }) as { snapshot: Record<string, unknown> };
}

async function waitForSnapshotAfter(
  messages: unknown[],
  startIndex: number,
  activeWorkspaceId: string,
  predicate: (snapshot: Record<string, unknown>) => boolean,
): Promise<{ snapshot: Record<string, unknown> }> {
  await waitFor(() =>
    messages.slice(startIndex).some((message) => {
      const frame = message as { type?: string; snapshot?: Record<string, unknown> };
      return frame.type === 'snapshot' &&
        frame.snapshot?.activeWorkspaceId === activeWorkspaceId &&
        predicate(frame.snapshot);
    }),
  );
  return latestSnapshotFor(messages.slice(startIndex), activeWorkspaceId) as { snapshot: Record<string, unknown> };
}

function latestSnapshotFor(messages: unknown[], activeWorkspaceId: string): Record<string, unknown> | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const frame = messages[index] as { type?: string; snapshot?: Record<string, unknown> };
    if (frame.type === 'snapshot' && frame.snapshot?.activeWorkspaceId === activeWorkspaceId) {
      return frame.snapshot;
    }
  }
  return null;
}

async function waitForError(messages: unknown[], text: string): Promise<unknown> {
  await waitFor(() =>
    messages.some((message) => {
      const frame = message as { type?: string; message?: string };
      return frame.type === 'error' && typeof frame.message === 'string' && frame.message.includes(text);
    }),
  );
  return messages.find((message) => {
    const frame = message as { type?: string; message?: string };
    return frame.type === 'error' && typeof frame.message === 'string' && frame.message.includes(text);
  });
}

async function getJson<T = unknown>(url: string, token?: string): Promise<T> {
  const res = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : undefined });
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}

async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as T;
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 1500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for condition');
}

async function readPersistedSession(dir: string, id: string): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(join(dir, `${id}.jsonl`), 'utf8');
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function writePersistedSession(
  dir: string,
  id: string,
  events: ReadonlyArray<Record<string, unknown>>,
  overrides: { readonly firstPrompt?: string | null; readonly lastActivity?: string; readonly cwd?: string } = {},
) {
  await writeFile(join(dir, `${id}.meta.json`), JSON.stringify({
    id,
    cwd: overrides.cwd ?? '/repo/old',
    startedAt: '2026-06-08T10:00:00.000Z',
    lastActivity: overrides.lastActivity ?? '2026-06-08T10:20:00.000Z',
    eventCount: events.length,
    firstPrompt: overrides.firstPrompt === undefined ? 'Archived work' : overrides.firstPrompt,
    provider: 'openai-codex',
    model: 'gpt-5',
  }));
  await writeFile(join(dir, `${id}.jsonl`), events.map((event) => JSON.stringify(event)).join('\n') + '\n');
}

async function writeDesktopChat(
  dir: string,
  workspaceId: string,
  events: ReadonlyArray<Record<string, unknown>>,
) {
  await writeFile(join(dir, `${workspaceId}.jsonl`), events.map((event, index) => JSON.stringify({
    id: `${workspaceId}-${index}`,
    seq: index,
    sessionId: workspaceId,
    turnId: `turn-${workspaceId}`,
    source: event.type === 'user_prompt' ? 'user' : 'model',
    ...event,
  })).join('\n') + '\n');
}
