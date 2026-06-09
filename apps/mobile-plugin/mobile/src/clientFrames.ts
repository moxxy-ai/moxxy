export type AskResponse = Record<string, unknown>;

interface WorkspaceInput {
  readonly workspaceId: string | null;
}

export interface RunTurnInput extends WorkspaceInput {
  readonly prompt: string;
  readonly attachments?: ReadonlyArray<PromptAttachment>;
}

export interface PromptAttachment {
  readonly kind: 'stdin' | 'file' | 'image' | 'document' | 'audio';
  readonly content: string;
  readonly name?: string;
  readonly mediaType?: string;
}

export interface AbortTurnInput extends WorkspaceInput {
  readonly turnId: string;
}

export interface AskResponseInput {
  readonly requestId: string;
  readonly response: AskResponse;
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

export interface TranscribeInput extends WorkspaceInput {
  readonly audioBase64: string;
  readonly mimeType: string;
}

export interface GoalInput extends WorkspaceInput {
  readonly objective: string;
}

export interface WorkflowListInput extends WorkspaceInput {}

export interface WorkflowRunInput extends WorkspaceInput {
  readonly name: string;
}

export function buildRunTurnFrame(input: RunTurnInput): Record<string, unknown> {
  return {
    type: 'runTurn',
    id: frameId('run'),
    workspaceId: input.workspaceId,
    prompt: input.prompt,
    ...(input.attachments && input.attachments.length > 0 ? { attachments: input.attachments } : {}),
  };
}

export function buildAbortTurnFrame(input: AbortTurnInput): Record<string, unknown> {
  return {
    type: 'abortTurn',
    id: frameId('abort'),
    workspaceId: input.workspaceId,
    turnId: input.turnId,
  };
}

export function buildAskResponseFrame(input: AskResponseInput): Record<string, unknown> {
  return {
    type: 'ask.respond',
    id: frameId('ask'),
    requestId: input.requestId,
    response: input.response,
  };
}

export function buildSetAutoApproveFrame(input: AutoApproveInput): Record<string, unknown> {
  return {
    type: 'setAutoApprove',
    id: frameId('auto'),
    workspaceId: input.workspaceId,
    enabled: input.enabled,
  };
}

export function buildSetModeFrame(input: SetModeInput): Record<string, unknown> {
  return {
    type: 'setMode',
    id: frameId('mode'),
    workspaceId: input.workspaceId,
    mode: input.mode,
  };
}

export function buildRunCommandFrame(input: RunCommandInput): Record<string, unknown> {
  return {
    type: 'runCommand',
    id: frameId('command'),
    workspaceId: input.workspaceId,
    name: input.name,
    args: input.args,
  };
}

export function buildWorkflowListFrame(input: WorkflowListInput): Record<string, unknown> {
  return {
    type: 'workflow.list',
    id: frameId('workflow_list'),
    workspaceId: input.workspaceId,
  };
}

export function buildWorkflowRunFrame(input: WorkflowRunInput): Record<string, unknown> {
  return {
    type: 'workflow.run',
    id: frameId('workflow_run'),
    workspaceId: input.workspaceId,
    name: input.name,
  };
}

export function buildTranscribeFrame(input: TranscribeInput): Record<string, unknown> {
  return {
    type: 'transcribe',
    id: frameId('transcribe'),
    workspaceId: input.workspaceId,
    audioBase64: input.audioBase64,
    mimeType: input.mimeType,
  };
}

export function buildSelectWorkspaceFrame(workspaceId: string): Record<string, unknown> {
  return {
    type: 'selectWorkspace',
    id: frameId('select'),
    workspaceId,
  };
}

export function buildNewSessionFrame(input: WorkspaceInput): Record<string, unknown> {
  return {
    type: 'newSession',
    id: frameId('new'),
    workspaceId: input.workspaceId,
  };
}

export function buildGoalFrames(input: GoalInput): ReadonlyArray<Record<string, unknown>> {
  return [
    buildSetModeFrame({ workspaceId: input.workspaceId, mode: 'goal' }),
    buildSetAutoApproveFrame({ workspaceId: input.workspaceId, enabled: true }),
    buildRunTurnFrame({ workspaceId: input.workspaceId, prompt: input.objective }),
  ];
}

function frameId(prefix: string): string {
  return `mobile_${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
