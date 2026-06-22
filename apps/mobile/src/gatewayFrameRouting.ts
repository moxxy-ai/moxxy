import { textOf } from './utils/record';

export interface SelectSessionActions {
  readonly setActiveSession: (id: string) => Promise<void>;
}

export function routeSelectWorkspaceFrame(
  frame: Record<string, unknown>,
  actions: SelectSessionActions,
): boolean {
  if (textOf(frame.type) !== 'selectWorkspace') return false;
  const id = textOf(frame.workspaceId);
  if (id) void actions.setActiveSession(id).catch(() => undefined);
  return true;
}
