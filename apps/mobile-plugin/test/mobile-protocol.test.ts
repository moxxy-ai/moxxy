import { describe, expect, it } from 'vitest';
import { applyGatewayFrame, emptyMobileState } from '../mobile/src/protocol';

describe('mobile protocol reducer', () => {
  it('stores snapshots and appends chat events without UI coupling', () => {
    const withSnapshot = applyGatewayFrame(emptyMobileState(), {
      type: 'snapshot',
      snapshot: {
        activeWorkspaceId: 'workspace-1',
        workspaces: [{ id: 'workspace-1', name: 'Moxxy', unread: false }],
        sessions: [{ id: 'workspace-1', firstPrompt: 'ship it', live: true, readOnly: false }],
        session: { id: 'session-1' },
        agents: [{ id: 'agent-1', label: 'Agent 1' }],
        workflows: [{ name: 'daily-report', enabled: true }],
        pendingPermissions: [],
        pendingAsks: [],
        commands: [],
        streamingText: 'Working',
        sending: true,
        activeTurnId: 'turn-1',
        queue: [{ id: 'q-1', prompt: 'next' }],
        compacting: false,
        usage: { latestPrompt: 100 },
        autoApprove: true,
        activeMode: 'goal',
        activeProvider: 'openai-codex',
        modeBadge: { label: 'Goal' },
      },
    });
    const withEvent = applyGatewayFrame(withSnapshot, {
      type: 'event',
      event: { type: 'chat.message', role: 'assistant', text: 'Done' },
    });

    expect(withEvent.activeWorkspaceId).toBe('workspace-1');
    expect(withEvent.workspaces).toEqual([{ id: 'workspace-1', name: 'Moxxy', unread: false }]);
    expect(withEvent.sessions).toEqual([{ id: 'workspace-1', firstPrompt: 'ship it', live: true, readOnly: false }]);
    expect(withEvent.session?.id).toBe('session-1');
    expect(withEvent.agents).toHaveLength(1);
    expect(withEvent.workflows).toEqual([{ name: 'daily-report', enabled: true }]);
    expect(withEvent.streamingText).toBe('Working');
    expect(withEvent.sending).toBe(true);
    expect(withEvent.activeTurnId).toBe('turn-1');
    expect(withEvent.queue).toEqual([{ id: 'q-1', prompt: 'next' }]);
    expect(withEvent.autoApprove).toBe(true);
    expect(withEvent.activeMode).toBe('goal');
    expect(withEvent.activeProvider).toBe('openai-codex');
    expect(withEvent.chatEvents).toEqual([{ type: 'chat.message', role: 'assistant', text: 'Done' }]);
  });

  it('resets derived runtime state after disconnect', () => {
    const withSnapshot = applyGatewayFrame(emptyMobileState(), {
      type: 'snapshot',
      snapshot: {
        connected: true,
        activeWorkspaceId: 'workspace-1',
        workspaces: [{ id: 'workspace-1' }],
        sessions: [{ id: 'session-1' }],
        workflows: [{ name: 'daily' }],
        chatEvents: [{ id: 'event-1', type: 'assistant_message', content: 'Ready' }],
        activeProvider: 'openai-codex',
      },
    });

    const reset = applyGatewayFrame(withSnapshot, { type: 'reset' });

    expect(reset).toEqual(emptyMobileState());
  });

  it('upserts pending permission requests and removes resolved ones', () => {
    const requested = applyGatewayFrame(emptyMobileState(), {
      type: 'permission.requested',
      permission: { id: 'perm-1', title: 'Run command' },
    });
    const resolved = applyGatewayFrame(requested, {
      type: 'permission.resolved',
      permissionId: 'perm-1',
    });

    expect(requested.pendingPermissions).toEqual([{ id: 'perm-1', title: 'Run command' }]);
    expect(resolved.pendingPermissions).toEqual([]);
  });

  it('upserts pending ask requests and removes resolved asks', () => {
    const requested = applyGatewayFrame(emptyMobileState(), {
      type: 'ask.request',
      ask: { requestId: 'ask-1', kind: 'approval', title: 'Continue?' },
    });
    const updated = applyGatewayFrame(requested, {
      type: 'ask.request',
      ask: { requestId: 'ask-1', kind: 'approval', title: 'Continue with changes?' },
    });
    const resolved = applyGatewayFrame(updated, {
      type: 'ask.resolved',
      requestId: 'ask-1',
    });

    expect(updated.pendingAsks).toEqual([
      { requestId: 'ask-1', kind: 'approval', title: 'Continue with changes?' },
    ]);
    expect(resolved.pendingAsks).toEqual([]);
  });

  it('keeps inactive workspace events out of the visible transcript', () => {
    const withSnapshot = applyGatewayFrame(emptyMobileState(), {
      type: 'snapshot',
      snapshot: {
        activeWorkspaceId: 'workspace-1',
        workspaces: [
          { id: 'workspace-1', name: 'Active', unread: false },
          { id: 'workspace-2', name: 'Background', unread: false },
        ],
      },
    });
    const withEvent = applyGatewayFrame(withSnapshot, {
      type: 'event',
      event: { type: 'assistant_message', workspaceId: 'workspace-2', content: 'Background update' },
    });
    const selected = applyGatewayFrame(withEvent, {
      type: 'connection',
      status: 'workspace.selected',
      activeWorkspaceId: 'workspace-2',
    });

    expect(selected.activeWorkspaceId).toBe('workspace-2');
    expect(selected.workspaces).toEqual([
      { id: 'workspace-1', name: 'Active', unread: false },
      { id: 'workspace-2', name: 'Background', unread: false },
    ]);
    expect(withEvent.chatEvents).toEqual([]);
    expect(withEvent.workspaces).toEqual([
      { id: 'workspace-1', name: 'Active', unread: false },
      { id: 'workspace-2', name: 'Background', unread: true },
    ]);
    expect(selected.chatEvents).toEqual([]);
  });

  it('deduplicates replayed chat events by event id', () => {
    const event = { id: 'event-1', type: 'assistant_message', content: 'Done' };
    const withEvent = applyGatewayFrame(emptyMobileState(), {
      type: 'event',
      event,
    });
    const replayedEvent = applyGatewayFrame(withEvent, {
      type: 'event',
      event,
    });
    const replayedSnapshot = applyGatewayFrame(emptyMobileState(), {
      type: 'snapshot',
      snapshot: {
        chatEvents: [
          event,
          event,
          { id: 'event-2', type: 'tool_call_requested', callId: 'call-1', name: 'Read' },
        ],
      },
    });

    expect(replayedEvent.chatEvents).toEqual([event]);
    expect(replayedSnapshot.chatEvents).toEqual([
      event,
      { id: 'event-2', type: 'tool_call_requested', callId: 'call-1', name: 'Read' },
    ]);
  });

  it('tracks auto-approve acknowledgements from the gateway', () => {
    const updated = applyGatewayFrame(emptyMobileState(), {
      type: 'connection',
      status: 'auto-approve.updated',
      autoApprove: true,
    });

    expect(updated.autoApprove).toBe(true);
  });

  it('tracks manual compact command lifecycle without waiting for the next chat turn', () => {
    const started = applyGatewayFrame(emptyMobileState(), {
      type: 'connection',
      status: 'command.started',
      commandName: 'compact',
    });
    const completed = applyGatewayFrame(started, {
      type: 'connection',
      status: 'command.completed',
      commandName: 'compact',
    });

    expect(started.compacting).toBe(true);
    expect(completed.compacting).toBe(false);
  });

  it('stores completed transcription text for the composer to consume', () => {
    const updated = applyGatewayFrame(emptyMobileState(), {
      type: 'transcribe.result',
      text: 'Cześć Moxxy',
    });

    expect(updated.transcriptionText).toBe('Cześć Moxxy');
    expect(updated.transcribing).toBe(false);
  });
});
