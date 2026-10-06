import { broadcastHostEvent } from './event-bus.js';

interface SessionModelSelection {
  readonly model: string | null;
  readonly contextWindow?: number;
}

const selectedModels = new Map<string, SessionModelSelection>();

export function getSessionModel(workspaceId: string): string | null {
  return selectedModels.get(workspaceId)?.model ?? null;
}

export function getSessionModelContextWindow(workspaceId: string): number | undefined {
  return selectedModels.get(workspaceId)?.contextWindow;
}

export function setSessionModel(
  workspaceId: string,
  model: string | null,
  opts: { readonly force?: boolean; readonly contextWindow?: number | null } = {},
): void {
  const next = model ?? null;
  const current = selectedModels.get(workspaceId);
  // A turn sends its model explicitly but does not resend picker metadata. Keep
  // the context override when that model is unchanged; a different model clears it.
  const contextWindow = opts.contextWindow === undefined
    ? current?.model === next ? current.contextWindow : undefined
    : opts.contextWindow ?? undefined;
  if (
    !opts.force && current?.model === next
    && current.contextWindow === contextWindow
  ) return;
  selectedModels.set(workspaceId, {
    model: next,
    ...(contextWindow !== undefined ? { contextWindow } : {}),
  });
  broadcastHostEvent('session.model.changed', {
    workspaceId,
    model: next,
    ...(contextWindow !== undefined ? { contextWindow } : {}),
  });
}
