import { useState } from 'react';

/**
 * The session's active mode, held steady.
 *
 * The session's info is fetched again at the start and end of every turn and
 * is unknown while it is. Reading the mode straight from it makes whatever
 * shows the mode blink on each turn, so the last known mode stands until the
 * info says otherwise or the conversation changes.
 */
export function useActiveMode(
  workspaceId: string,
  info: { readonly activeMode: string | null } | null,
): string | null {
  const [seen, setSeen] = useState<{ id: string; mode: string | null }>({
    id: workspaceId,
    mode: null,
  });
  const kept = seen.id === workspaceId ? seen.mode : null;
  const mode = info ? info.activeMode : kept;
  if (seen.id !== workspaceId || seen.mode !== mode) setSeen({ id: workspaceId, mode });
  return mode;
}
