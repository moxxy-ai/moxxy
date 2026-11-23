const drafts = new Map<string, string>();

export function getSessionDraft(workspaceId: string): string {
  return drafts.get(workspaceId) ?? '';
}

export function setSessionDraft(workspaceId: string, value: string): void {
  if (value) drafts.set(workspaceId, value);
  else drafts.delete(workspaceId);
}
