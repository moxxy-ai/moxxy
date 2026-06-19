import { describe, expect, it } from 'vitest';
import { buildChatTranscript } from '../mobile/src/chatTranscript';
import {
  createMoxxyLiveActivityClient,
  deriveMoxxyLiveActivitySnapshot,
  deriveMoxxyLiveActivityTransition,
  planMoxxyLiveActivitySync,
  type MoxxyLiveActivitySnapshot,
} from '../mobile/src/liveActivity';
import { emptyMobileState, type MobileState } from '../mobile/src/protocol';

const baseState = (overrides: Partial<MobileState> = {}): MobileState => ({
  ...emptyMobileState(),
  connected: true,
  activeWorkspaceId: 'session-1',
  session: { id: 'session-1', name: 'Deep research QA', workspaceName: 'Tata' },
  ...overrides,
});

describe('mobile live activity state', () => {
  it('stays inactive when no agent work is happening', () => {
    expect(deriveMoxxyLiveActivitySnapshot({
      state: baseState(),
      transcript: [],
    })).toEqual({ active: false, reason: 'idle' });
  });

  it('prioritizes pending user decisions over background thinking', () => {
    const snapshot = deriveMoxxyLiveActivitySnapshot({
      state: baseState({
        sending: true,
        activeTurnId: 'turn-1',
        pendingPermissions: [{ id: 'perm-1', toolName: 'web_fetch' }],
      }),
      transcript: [],
    });

    expect(snapshot).toMatchObject({
      active: true,
      phase: 'waiting',
      progress: 0.85,
      title: 'Deep research QA',
      detail: 'Waiting for your decision',
      pendingCount: 1,
    });
  });

  it('summarizes the latest running tool from the transcript', () => {
    const transcript = buildChatTranscript([
      { id: 'u1', type: 'user_prompt', text: 'Search' },
      { id: 't1', type: 'tool_call_requested', callId: 'call-1', name: 'web_fetch', input: { url: 'https://example.com' } },
    ]);

    const snapshot = deriveMoxxyLiveActivitySnapshot({
      state: baseState({ sending: true, activeTurnId: 'turn-1' }),
      transcript,
    });

    expect(snapshot).toMatchObject({
      active: true,
      phase: 'tool',
      progress: 0.55,
      detail: 'Running web_fetch',
      currentTool: 'web_fetch',
    });
  });

  it('summarizes a running subagent fan-out', () => {
    const transcript = buildChatTranscript([
      {
        id: 'sg1',
        type: 'plugin_event',
        pluginId: '@moxxy/subagents',
        subtype: 'subagent_started',
        payload: { childSessionId: 'child-1', label: 'subagent-1', agentType: 'default' },
      },
      {
        id: 'sg2',
        type: 'plugin_event',
        pluginId: '@moxxy/subagents',
        subtype: 'subagent_started',
        payload: { childSessionId: 'child-2', label: 'subagent-2', agentType: 'default' },
      },
    ]);

    const snapshot = deriveMoxxyLiveActivitySnapshot({
      state: baseState({ sending: true, activeTurnId: 'turn-1' }),
      transcript,
    });

    expect(snapshot).toMatchObject({
      active: true,
      phase: 'subagents',
      progress: 0.7,
      detail: '2 default agents running',
      subagentCount: 2,
    });
  });

  it('emits a completed transition after an active turn finishes with an assistant message', () => {
    const previous: MoxxyLiveActivitySnapshot = {
      active: true,
      phase: 'working',
      progress: 0.35,
      sessionId: 'session-1',
      workspaceId: 'session-1',
      title: 'Deep research QA',
      subtitle: 'Tata',
      detail: 'Thinking',
      pendingCount: 0,
      subagentCount: 0,
    };
    const transcript = buildChatTranscript([
      { id: 'u1', type: 'user_prompt', text: 'Ping' },
      { id: 'a1', type: 'assistant_message', content: 'OK' },
    ]);
    const current = deriveMoxxyLiveActivitySnapshot({
      state: baseState({ sending: false, activeTurnId: null }),
      transcript,
    });

    expect(deriveMoxxyLiveActivityTransition(previous, current, transcript)).toMatchObject({
      kind: 'end',
      snapshot: {
        active: true,
        phase: 'completed',
        progress: 1,
        detail: 'Done',
      },
      notification: {
        title: 'Moxxy finished',
        body: 'Deep research QA is ready.',
      },
    });
  });

  it('emits a failed transition after an active turn ends with an error', () => {
    const previous: MoxxyLiveActivitySnapshot = {
      active: true,
      phase: 'tool',
      progress: 0.55,
      sessionId: 'session-1',
      workspaceId: 'session-1',
      title: 'Deep research QA',
      subtitle: 'Tata',
      detail: 'Running computer_click',
      currentTool: 'computer_click',
      pendingCount: 0,
      subagentCount: 0,
    };
    const transcript = buildChatTranscript([
      { id: 'u1', type: 'user_prompt', text: 'Click' },
      { id: 'e1', type: 'turn_error', message: 'System Events error -25208' },
    ]);
    const current = deriveMoxxyLiveActivitySnapshot({
      state: baseState({ sending: false, activeTurnId: null }),
      transcript,
    });

    expect(deriveMoxxyLiveActivityTransition(previous, current, transcript)).toMatchObject({
      kind: 'end',
      snapshot: {
        active: true,
        phase: 'failed',
        progress: 1,
        detail: 'Failed',
      },
      notification: {
        title: 'Moxxy needs attention',
      },
    });
  });
});

describe('mobile live activity native client', () => {
  it('no-ops safely when the native module is unavailable', async () => {
    const client = createMoxxyLiveActivityClient({ nativeModule: null, platformOS: 'web' });

    await expect(client.isAvailable()).resolves.toBe(false);
    await expect(client.startOrUpdate({
      active: true,
      phase: 'working',
      progress: 0.35,
      sessionId: 'session-1',
      workspaceId: 'session-1',
      title: 'Deep research QA',
      subtitle: 'Tata',
      detail: 'Thinking',
      pendingCount: 0,
      subagentCount: 0,
    })).resolves.toEqual({ active: false });
    await expect(client.end({
      active: true,
      phase: 'completed',
      progress: 1,
      sessionId: 'session-1',
      workspaceId: 'session-1',
      title: 'Deep research QA',
      subtitle: 'Tata',
      detail: 'Done',
      pendingCount: 0,
      subagentCount: 0,
    })).resolves.toBeUndefined();
  });
});

describe('mobile live activity sync planning', () => {
  const activeSnapshot: MoxxyLiveActivitySnapshot = {
    active: true,
    phase: 'working',
    progress: 0.35,
    sessionId: 'session-1',
    workspaceId: 'session-1',
    title: 'Deep research QA',
    subtitle: 'Tata',
    detail: 'Thinking',
    pendingCount: 0,
    subagentCount: 0,
  };

  it('sends the first active snapshot immediately', () => {
    expect(planMoxxyLiveActivitySync({
      lastSent: null,
      next: activeSnapshot,
      now: 1000,
      lastSentAt: 0,
      minUpdateMs: 1500,
    })).toEqual({ kind: 'send' });
  });

  it('defers noisy equivalent-phase updates but keeps the latest due time', () => {
    expect(planMoxxyLiveActivitySync({
      lastSent: activeSnapshot,
      next: { ...activeSnapshot, detail: 'Writing response', progress: 0.45 },
      now: 1800,
      lastSentAt: 1000,
      minUpdateMs: 1500,
    })).toEqual({ kind: 'defer', dueAt: 2500 });
  });

  it('sends urgent waiting states immediately even inside the throttle window', () => {
    expect(planMoxxyLiveActivitySync({
      lastSent: activeSnapshot,
      next: { ...activeSnapshot, phase: 'waiting', detail: 'Waiting for your decision', progress: 0.85, pendingCount: 1 },
      now: 1200,
      lastSentAt: 1000,
      minUpdateMs: 1500,
    })).toEqual({ kind: 'send' });
  });
});
