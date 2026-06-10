/**
 * Ports the SPIRIT of the reference's mobile-client-frames tests: the builders
 * now target the desktop IPC contract (typed `{ command, args }` frames for
 * `MoxxyApi.invoke`) instead of raw gateway JSON, but the same intents map to
 * the same builder names and the goal sequence keeps its strict order.
 */

import { describe, expect, it, vi } from 'vitest';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import {
  buildAbortTurnFrame,
  buildAskResponseFrame,
  buildGoalFrames,
  buildNewSessionFrame,
  buildRunCommandFrame,
  buildRunTurnFrame,
  buildSetAutoApproveFrame,
  buildSetModeFrame,
  buildTranscribeFrame,
  buildWorkflowDetailFrame,
  buildWorkflowListFrame,
  buildWorkflowRunFrame,
  buildWorkflowSaveFrame,
  buildWorkflowValidateFrame,
  invokeFrame,
} from '../clientFrames';

describe('mobile client frame builders', () => {
  it('builds composer control frames with workspace context', () => {
    expect(
      buildRunTurnFrame({
        workspaceId: 'workspace-1',
        prompt: 'ship it',
        attachments: [{ kind: 'file', name: 'notes.txt', content: 'hello' }],
      }),
    ).toEqual({
      command: 'session.runTurn',
      args: {
        workspaceId: 'workspace-1',
        prompt: 'ship it',
        inlineAttachments: [{ kind: 'file', name: 'notes.txt', content: 'hello' }],
      },
    });
    expect(buildAbortTurnFrame({ workspaceId: 'workspace-1', turnId: 'turn-1' })).toEqual({
      command: 'session.abortTurn',
      args: { workspaceId: 'workspace-1', turnId: 'turn-1' },
    });
    expect(buildTranscribeFrame({ audioBase64: 'AAAA', mimeType: 'audio/m4a' })).toEqual({
      command: 'session.transcribe',
      args: { audioBase64: 'AAAA', mimeType: 'audio/m4a' },
    });
  });

  it('omits a null workspace and empty attachments so the host defaults apply', () => {
    expect(buildRunTurnFrame({ workspaceId: null, prompt: 'hi', attachments: [] })).toEqual({
      command: 'session.runTurn',
      args: { prompt: 'hi' },
    });
    expect(buildNewSessionFrame({ workspaceId: null })).toEqual({
      command: 'session.newSession',
      args: {},
    });
  });

  it('builds goal mode as mode switch, auto-approve, then runTurn', () => {
    expect(buildGoalFrames({ workspaceId: 'workspace-1', objective: 'Finish the feature' })).toEqual([
      { command: 'session.setMode', args: { workspaceId: 'workspace-1', mode: 'goal' } },
      { command: 'session.setAutoApprove', args: { workspaceId: 'workspace-1', enabled: true } },
      { command: 'session.runTurn', args: { workspaceId: 'workspace-1', prompt: 'Finish the feature' } },
    ]);
  });

  it('builds ask, session, command, and auto-approve frames', () => {
    expect(buildAskResponseFrame({ requestId: 'ask-1', response: { mode: 'allow_session' } })).toEqual({
      command: 'ask.respond',
      args: { requestId: 'ask-1', response: { mode: 'allow_session' } },
    });
    expect(buildSetAutoApproveFrame({ workspaceId: 'workspace-1', enabled: false })).toEqual({
      command: 'session.setAutoApprove',
      args: { workspaceId: 'workspace-1', enabled: false },
    });
    expect(buildSetModeFrame({ workspaceId: 'workspace-1', mode: 'research' })).toEqual({
      command: 'session.setMode',
      args: { workspaceId: 'workspace-1', mode: 'research' },
    });
    expect(buildRunCommandFrame({ workspaceId: 'workspace-1', name: 'compact', args: '--now' })).toEqual({
      command: 'session.runCommand',
      args: { workspaceId: 'workspace-1', name: 'compact', args: '--now' },
    });
  });

  it('builds workflow list and run frames', () => {
    expect(buildWorkflowListFrame()).toEqual({ command: 'workflows.list', args: undefined });
    expect(buildWorkflowRunFrame({ name: 'codzienny-obrazek-email' })).toEqual({
      command: 'workflows.run',
      args: { name: 'codzienny-obrazek-email' },
    });
  });

  it('builds visual-builder frames (validate / save / detail)', () => {
    expect(buildWorkflowValidateFrame({ yaml: 'name: x' })).toEqual({
      command: 'workflows.validateDraft',
      args: { yaml: 'name: x' },
    });
    expect(buildWorkflowSaveFrame({ yaml: 'name: x' })).toEqual({
      command: 'workflows.save',
      args: { yaml: 'name: x' },
    });
    expect(buildWorkflowDetailFrame({ name: 'refine-draft' })).toEqual({
      command: 'workflows.getRun',
      args: { name: 'refine-draft' },
    });
  });

  it('invokeFrame dispatches the frame over the transport and returns the typed reply', async () => {
    const invoke = vi.fn(async () => ({ turnId: 'turn-9' }));
    const api = { invoke, subscribe: vi.fn() } as unknown as MoxxyApi;
    const result = await invokeFrame(api, buildRunTurnFrame({ workspaceId: 'w1', prompt: 'go' }));
    expect(result).toEqual({ turnId: 'turn-9' });
    expect(invoke).toHaveBeenCalledWith('session.runTurn', { workspaceId: 'w1', prompt: 'go' });
  });
});
