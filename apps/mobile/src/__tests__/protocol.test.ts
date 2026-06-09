/**
 * Ports the SPIRIT of the reference's mobile-protocol tests onto this app's
 * state engine: event folding is composed from @moxxy/client-core's runtime
 * (createRuntime/applyEvent — the same reducer the desktop uses), and
 * `buildMobileState` presents those snapshots in the reference's MobileState
 * shape. The local slice (transcription, errors) has its own tiny reducer.
 */

import { describe, expect, it } from 'vitest';
import { applyEvent, createRuntime, type ChatRuntime } from '@moxxy/client-core';
import type { MoxxyEvent } from '@moxxy/sdk';
import type { AskRequest } from '@moxxy/desktop-ipc-contract';
import {
  applyLocalFrame,
  buildMobileState,
  buildUsageRecord,
  emptyLocalUiState,
  emptyMobileState,
  toAskResponse,
  toPermissionMode,
  type MobileStateSources,
} from '../protocol';

function event(fields: Record<string, unknown>): MoxxyEvent {
  return fields as unknown as MoxxyEvent;
}

function chatOf(rt: ChatRuntime, overrides: Partial<MobileStateSources['chat']> = {}) {
  return {
    events: rt.log.toArray(),
    streamingText: rt.streamingText,
    sending: rt.sending,
    activeTurnId: rt.activeTurnId,
    compacting: false,
    error: rt.error,
    ...overrides,
  };
}

const EMPTY_USAGE = {
  latestPrompt: null,
  perCall: [],
  calls: 0,
  totalInput: 0,
  totalCacheRead: 0,
  totalCacheCreation: 0,
  totalOutput: 0,
};

function sources(overrides: Partial<MobileStateSources> = {}): MobileStateSources {
  return {
    connected: false,
    workspaceId: null,
    info: null,
    chat: chatOf(createRuntime()),
    queue: [],
    usage: EMPTY_USAGE,
    contextWindow: null,
    asks: [],
    autoApprove: false,
    workflows: [],
    local: emptyLocalUiState(),
    ...overrides,
  };
}

describe('mobile state presenter', () => {
  it('presents the session snapshot and runtime sources without UI coupling', () => {
    const rt = createRuntime();
    applyEvent(rt, event({ id: 'u1', type: 'user_prompt', text: 'ship it' }));
    rt.sending = true;
    rt.activeTurnId = 'turn-1';
    const state = buildMobileState(
      sources({
        connected: true,
        workspaceId: 'workspace-1',
        info: {
          sessionId: 'session-1',
          cwd: '/Users/dev/moxxy',
          activeProvider: 'openai-codex',
          activeMode: 'goal',
          activeModeBadge: { label: 'Goal' },
          commands: [{ name: 'compact', description: 'Compact the context' }],
        },
        chat: chatOf(rt, { streamingText: 'Working' }),
        queue: [{ id: 'q-1', prompt: 'next' }],
        usage: { ...EMPTY_USAGE, latestPrompt: 100, perCall: [100], calls: 1 },
        contextWindow: 200_000,
        autoApprove: true,
        workflows: [{ name: 'daily-report', enabled: true }],
      }),
    );

    expect(state.connected).toBe(true);
    expect(state.activeWorkspaceId).toBe('workspace-1');
    expect(state.workspaces).toEqual([{ id: 'workspace-1', name: 'moxxy', unread: false }]);
    expect(state.sessions[0]).toMatchObject({
      id: 'workspace-1',
      live: true,
      readOnly: false,
      firstPrompt: 'ship it',
      provider: 'openai-codex',
    });
    expect(state.session).toMatchObject({ id: 'session-1', readOnly: false });
    expect(state.workflows).toEqual([{ name: 'daily-report', enabled: true }]);
    expect(state.commands).toEqual([{ name: 'compact', description: 'Compact the context' }]);
    expect(state.streamingText).toBe('Working');
    expect(state.sending).toBe(true);
    expect(state.activeTurnId).toBe('turn-1');
    expect(state.queue).toEqual([{ id: 'q-1', prompt: 'next' }]);
    expect(state.autoApprove).toBe(true);
    expect(state.activeMode).toBe('goal');
    expect(state.activeProvider).toBe('openai-codex');
    expect(state.modeBadge).toEqual({ label: 'Goal' });
    expect(state.usage).toMatchObject({ latestPrompt: 100, contextWindow: 200_000 });
    expect(state.chatEvents).toHaveLength(1);
  });

  it('presents nothing before a workspace binds (empty shape parity)', () => {
    expect(buildMobileState(sources())).toEqual(emptyMobileState());
  });

  it('keeps assistant chunks in live streaming text instead of committed chat events', () => {
    const rt = createRuntime();
    applyEvent(rt, event({ id: 'chunk-1', type: 'assistant_chunk', delta: 'Piszę ' }));
    applyEvent(rt, event({ id: 'chunk-2', type: 'assistant_chunk', delta: 'odpowiedź' }));
    const streaming = buildMobileState(sources({ workspaceId: 'w1', chat: chatOf(rt) }));
    expect(streaming.chatEvents).toEqual([]);
    expect(streaming.streamingText).toBe('Piszę odpowiedź');

    applyEvent(
      rt,
      event({
        id: 'assistant-1',
        type: 'assistant_message',
        content: 'Piszę odpowiedź',
        stopReason: 'end_turn',
      }),
    );
    const committed = buildMobileState(sources({ workspaceId: 'w1', chat: chatOf(rt) }));
    expect(committed.streamingText).toBe('');
    expect(committed.chatEvents).toMatchObject([
      { id: 'assistant-1', type: 'assistant_message', content: 'Piszę odpowiedź' },
    ]);
  });

  it('deduplicates replayed chat events by event id', () => {
    const rt = createRuntime();
    const msg = event({ id: 'event-1', type: 'assistant_message', content: 'Done', stopReason: 'end_turn' });
    applyEvent(rt, msg);
    applyEvent(rt, msg); // replay (reconnect) — must not duplicate
    const state = buildMobileState(sources({ workspaceId: 'w1', chat: chatOf(rt) }));
    expect(state.chatEvents).toHaveLength(1);
  });

  it('filters bookkeeping events out of the transcript', () => {
    const rt = createRuntime();
    applyEvent(rt, event({ id: 'p1', type: 'provider_request' }));
    applyEvent(rt, event({ id: 'p2', type: 'mode_iteration' }));
    applyEvent(rt, event({ id: 'u1', type: 'user_prompt', text: 'hello' }));
    const state = buildMobileState(sources({ workspaceId: 'w1', chat: chatOf(rt) }));
    expect(state.chatEvents).toMatchObject([{ id: 'u1', type: 'user_prompt' }]);
  });

  it('routes permission/approval prompts through pendingAsks (pendingPermissions stays empty)', () => {
    const asks: AskRequest[] = [
      { requestId: 'ask-1', workspaceId: 'w1', kind: 'permission', tool: { name: 'web_fetch', input: {} } },
      { requestId: 'ask-2', workspaceId: 'w1', kind: 'approval' },
    ];
    const state = buildMobileState(sources({ workspaceId: 'w1', asks }));
    expect(state.pendingPermissions).toEqual([]);
    expect(state.pendingAsks).toMatchObject([
      { requestId: 'ask-1', kind: 'permission' },
      { requestId: 'ask-2', kind: 'approval' },
    ]);
  });

  it('normalizes UI ask responses into the strict wire shape', () => {
    expect(toPermissionMode('allow_once')).toBe('allow');
    expect(toPermissionMode('allow_session')).toBe('allow_session');
    expect(toPermissionMode('allow_always')).toBe('allow_always');
    expect(toPermissionMode('nonsense')).toBe('deny');
    expect(toAskResponse({ mode: 'allow_once', junk: 'dropped' })).toEqual({ mode: 'allow' });
    expect(toAskResponse({ optionId: 'proceed', text: 'go on' })).toEqual({
      optionId: 'proceed',
      text: 'go on',
    });
  });

  it('builds the usage record only once there is something to meter', () => {
    expect(buildUsageRecord(EMPTY_USAGE, null)).toBeNull();
    expect(buildUsageRecord(EMPTY_USAGE, 200_000)).toMatchObject({ contextWindow: 200_000 });
    expect(
      buildUsageRecord({ ...EMPTY_USAGE, latestPrompt: 1234, calls: 1 }, 200_000),
    ).toMatchObject({ latestPrompt: 1234, contextWindow: 200_000 });
  });

  it('tracks the transcription lifecycle in the local slice', () => {
    const started = applyLocalFrame(emptyLocalUiState(), { type: 'transcribe.started' });
    expect(started.transcribing).toBe(true);
    const done = applyLocalFrame(started, { type: 'transcribe.result', text: 'Cześć Moxxy' });
    expect(done.transcribing).toBe(false);
    expect(done.transcriptionText).toBe('Cześć Moxxy');
    expect(done.transcriptionId).toBe('transcribe-1');
    // A second result mints a NEW id so the composer consumes it again.
    const again = applyLocalFrame(done, { type: 'transcribe.result', text: 'Jeszcze raz' });
    expect(again.transcriptionId).toBe('transcribe-2');
  });

  it('collects errors and resets the local slice on a fresh connection', () => {
    const errored = applyLocalFrame(emptyLocalUiState(), { type: 'error', message: 'boom' });
    expect(errored.errors).toEqual(['boom']);
    expect(errored.transcribing).toBe(false);
    expect(applyLocalFrame(errored, { type: 'reset' })).toEqual(emptyLocalUiState());

    const state = buildMobileState(sources({ workspaceId: 'w1', local: errored }));
    expect(state.errors).toEqual(['boom']);
  });
});
