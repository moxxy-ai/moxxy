/**
 * Typed builders for the commands the mobile app issues.
 *
 * The reference app spoke its own gateway protocol: fire-and-forget JSON
 * frames over a raw socket. This port speaks the desktop IPC contract over
 * JSON-RPC, so a "frame" here is a typed `{ command, args }` pair aimed at
 * `MoxxyApi.invoke` — request/response instead of fire-and-forget. The builder
 * names stay the reference's (`buildRunTurnFrame`, `buildGoalFrames`, …) so the
 * hooks that consume them port over with minimal churn; `invokeFrame` is the
 * one execution seam that sends a frame and returns the host's typed reply.
 */

import type {
  IpcCommandName,
  IpcCommands,
  MoxxyApi,
  UserPromptAttachment,
} from '@moxxy/desktop-ipc-contract';

/** Inline attachment payload shipped with a turn (base64 bytes or inline
 *  text). Identical to the SDK's `UserPromptAttachment`, re-exported under the
 *  reference app's name so the attachment modules bind unchanged. */
export type PromptAttachment = UserPromptAttachment;

export interface CommandFrame<K extends IpcCommandName = IpcCommandName> {
  readonly command: K;
  readonly args: Parameters<IpcCommands[K]>[0];
}

/** Send one frame over the transport and await the host's typed reply. */
export function invokeFrame<K extends IpcCommandName>(
  api: MoxxyApi,
  frame: CommandFrame<K>,
): ReturnType<IpcCommands[K]> {
  const invoke = api.invoke as (command: K, args: unknown) => ReturnType<IpcCommands[K]>;
  return invoke(frame.command, frame.args);
}

interface WorkspaceInput {
  readonly workspaceId: string | null;
}

export interface RunTurnInput extends WorkspaceInput {
  readonly prompt: string;
  readonly attachments?: ReadonlyArray<PromptAttachment>;
}

export interface AbortTurnInput extends WorkspaceInput {
  readonly turnId: string;
}

export interface AskResponseInput {
  readonly requestId: string;
  readonly response: Parameters<IpcCommands['ask.respond']>[0]['response'];
}

export interface AutoApproveInput extends WorkspaceInput {
  readonly enabled: boolean;
}

export interface SetModeInput extends WorkspaceInput {
  readonly mode: string;
}

export interface RunCommandInput extends WorkspaceInput {
  readonly name: string;
  readonly args: string;
}

export interface TranscribeInput {
  readonly audioBase64: string;
  readonly mimeType?: string;
}

export interface GoalInput extends WorkspaceInput {
  readonly objective: string;
}

export interface WorkflowRunInput {
  readonly name: string;
}

/** `null` workspace (nothing selected yet) → omit and let the host default. */
function ws(workspaceId: string | null): { workspaceId?: string } {
  return workspaceId ? { workspaceId } : {};
}

export function buildRunTurnFrame(input: RunTurnInput): CommandFrame<'session.runTurn'> {
  return {
    command: 'session.runTurn',
    args: {
      ...ws(input.workspaceId),
      prompt: input.prompt,
      ...(input.attachments && input.attachments.length > 0
        ? { inlineAttachments: input.attachments }
        : {}),
    },
  };
}

export function buildAbortTurnFrame(input: AbortTurnInput): CommandFrame<'session.abortTurn'> {
  return {
    command: 'session.abortTurn',
    args: { ...ws(input.workspaceId), turnId: input.turnId },
  };
}

export function buildAskResponseFrame(input: AskResponseInput): CommandFrame<'ask.respond'> {
  return {
    command: 'ask.respond',
    args: { requestId: input.requestId, response: input.response },
  };
}

export function buildSetAutoApproveFrame(
  input: AutoApproveInput,
): CommandFrame<'session.setAutoApprove'> {
  return {
    command: 'session.setAutoApprove',
    args: { ...ws(input.workspaceId), enabled: input.enabled },
  };
}

export function buildSetModeFrame(input: SetModeInput): CommandFrame<'session.setMode'> {
  return {
    command: 'session.setMode',
    args: { ...ws(input.workspaceId), mode: input.mode },
  };
}

export function buildRunCommandFrame(input: RunCommandInput): CommandFrame<'session.runCommand'> {
  return {
    command: 'session.runCommand',
    args: { ...ws(input.workspaceId), name: input.name, args: input.args },
  };
}

export function buildNewSessionFrame(input: WorkspaceInput): CommandFrame<'session.newSession'> {
  return { command: 'session.newSession', args: ws(input.workspaceId) };
}

export function buildWorkflowListFrame(): CommandFrame<'workflows.list'> {
  return { command: 'workflows.list', args: undefined };
}

export function buildWorkflowRunFrame(input: WorkflowRunInput): CommandFrame<'workflows.run'> {
  return { command: 'workflows.run', args: { name: input.name } };
}

export function buildTranscribeFrame(input: TranscribeInput): CommandFrame<'session.transcribe'> {
  return {
    command: 'session.transcribe',
    args: {
      audioBase64: input.audioBase64,
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    },
  };
}

/** Goal mode = mode switch, then hands-off auto-approve, then the objective as
 *  a turn — same three-step sequence the reference fired, but awaited in order
 *  by the caller (each is a real request/response now). */
export function buildGoalFrames(
  input: GoalInput,
): readonly [
  CommandFrame<'session.setMode'>,
  CommandFrame<'session.setAutoApprove'>,
  CommandFrame<'session.runTurn'>,
] {
  return [
    buildSetModeFrame({ workspaceId: input.workspaceId, mode: 'goal' }),
    buildSetAutoApproveFrame({ workspaceId: input.workspaceId, enabled: true }),
    buildRunTurnFrame({ workspaceId: input.workspaceId, prompt: input.objective }),
  ];
}
