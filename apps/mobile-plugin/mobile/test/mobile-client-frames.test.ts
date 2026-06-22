import { describe, expect, it } from 'vitest';
import {
  buildAbortTurnFrame,
  buildAskResponseFrame,
  buildGoalFrames,
  buildRunCommandFrame,
  buildRunTurnFrame,
  buildSelectWorkspaceFrame,
  buildSetAutoApproveFrame,
  buildTranscribeFrame,
  buildWorkflowListFrame,
  buildWorkflowRunFrame,
} from '../src/clientFrames';

describe('mobile client frame builders', () => {
  it('builds composer control frames with workspace context', () => {
    expect(buildRunTurnFrame({
      workspaceId: 'workspace-1',
      prompt: 'ship it',
      attachments: [{ kind: 'file', name: 'notes.txt', content: 'hello' }],
    })).toMatchObject({
      type: 'runTurn',
      workspaceId: 'workspace-1',
      prompt: 'ship it',
      attachments: [{ kind: 'file', name: 'notes.txt', content: 'hello' }],
    });
    expect(buildAbortTurnFrame({ workspaceId: 'workspace-1', turnId: 'turn-1' })).toMatchObject({
      type: 'abortTurn',
      workspaceId: 'workspace-1',
      turnId: 'turn-1',
    });
    expect(buildTranscribeFrame({ workspaceId: 'workspace-1', audioBase64: 'AAAA', mimeType: 'audio/m4a' })).toMatchObject({
      type: 'transcribe',
      workspaceId: 'workspace-1',
      audioBase64: 'AAAA',
      mimeType: 'audio/m4a',
    });
  });

  it('builds goal mode as mode switch, auto-approve, then runTurn', () => {
    expect(buildGoalFrames({ workspaceId: 'workspace-1', objective: 'Finish the feature' })).toEqual([
      expect.objectContaining({ type: 'setMode', workspaceId: 'workspace-1', mode: 'goal' }),
      expect.objectContaining({ type: 'setAutoApprove', workspaceId: 'workspace-1', enabled: true }),
      expect.objectContaining({ type: 'runTurn', workspaceId: 'workspace-1', prompt: 'Finish the feature' }),
    ]);
  });

  it('builds action, session, command, and auto-approve frames', () => {
    expect(buildAskResponseFrame({ requestId: 'ask-1', response: { mode: 'allow_session' } })).toMatchObject({
      type: 'ask.respond',
      requestId: 'ask-1',
      response: { mode: 'allow_session' },
    });
    expect(buildSetAutoApproveFrame({ workspaceId: 'workspace-1', enabled: false })).toMatchObject({
      type: 'setAutoApprove',
      workspaceId: 'workspace-1',
      enabled: false,
    });
    expect(buildRunCommandFrame({ workspaceId: 'workspace-1', name: 'compact', args: '--now' })).toMatchObject({
      type: 'runCommand',
      workspaceId: 'workspace-1',
      name: 'compact',
      args: '--now',
    });
    expect(buildSelectWorkspaceFrame('workspace-2')).toMatchObject({
      type: 'selectWorkspace',
      workspaceId: 'workspace-2',
    });
  });

  it('builds workflow list and run frames', () => {
    expect(buildWorkflowListFrame({ workspaceId: 'workspace-1' })).toMatchObject({
      type: 'workflow.list',
      workspaceId: 'workspace-1',
    });
    expect(buildWorkflowRunFrame({ workspaceId: 'workspace-1', name: 'codzienny-obrazek-email' })).toMatchObject({
      type: 'workflow.run',
      workspaceId: 'workspace-1',
      name: 'codzienny-obrazek-email',
    });
  });
});
