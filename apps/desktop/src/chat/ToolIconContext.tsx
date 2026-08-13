import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { ToolIcon } from '@moxxy/sdk';
import { useActionCatalog } from '@moxxy/client-core';

/**
 * Name to declared icon, fetched once for the whole transcript.
 *
 * A context rather than a hook per row: the catalog comes from a `session.info`
 * round trip, and a transcript can hold hundreds of tool rows, so calling the
 * fetching hook in each leaf would mean hundreds of identical IPC calls to
 * render one screen.
 *
 * Empty is a valid state, not an error: every consumer falls back to the name
 * heuristic, which is what shipped before tools could declare anything.
 */
const ToolIconContext = createContext<ReadonlyMap<string, ToolIcon>>(new Map());

export function ToolIconProvider({
  workspaceId,
  children,
}: {
  readonly workspaceId?: string;
  readonly children: ReactNode;
}): JSX.Element {
  const catalog = useActionCatalog(workspaceId);
  const map = useMemo(() => {
    const out = new Map<string, ToolIcon>();
    for (const tool of catalog.tools) {
      if (tool.icon) out.set(tool.name, tool.icon);
    }
    return out;
  }, [catalog.tools]);
  return <ToolIconContext.Provider value={map}>{children}</ToolIconContext.Provider>;
}

/** The icon a tool declared, or undefined to let the name heuristic decide. */
export function useToolIcon(name: string): ToolIcon | undefined {
  return useContext(ToolIconContext).get(name);
}
