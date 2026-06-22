import { broadcastHostEvent } from './event-bus';

const selectedModels = new Map<string, string | null>();

export function getSessionModel(workspaceId: string): string | null {
  return selectedModels.get(workspaceId) ?? null;
}

export function setSessionModel(
  workspaceId: string,
  model: string | null,
  opts: { readonly force?: boolean } = {},
): void {
  const next = model ?? null;
  if (!opts.force && selectedModels.get(workspaceId) === next) return;
  selectedModels.set(workspaceId, next);
  broadcastHostEvent('session.model.changed', { workspaceId, model: next });
}
