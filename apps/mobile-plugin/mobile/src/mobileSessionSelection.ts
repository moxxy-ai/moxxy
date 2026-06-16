export interface SelectedSessionInput {
  readonly workspaceId: string | null;
  readonly ownerWorkspaceId: string | null;
  readonly connected: boolean;
}

export function buildSelectedSessionRecord(input: SelectedSessionInput): Record<string, unknown> | null {
  if (!input.workspaceId) return null;
  return {
    id: input.workspaceId,
    workspaceId: input.ownerWorkspaceId ?? input.workspaceId,
    live: input.connected,
    readOnly: !input.connected,
  };
}

export function selectedSessionReadOnly(input: {
  readonly sessionId: string;
  readonly activeWorkspaceId: string | null;
  readonly connected: boolean;
  readonly readOnly?: boolean;
}): boolean {
  return input.readOnly === true || (input.sessionId === input.activeWorkspaceId && !input.connected);
}
