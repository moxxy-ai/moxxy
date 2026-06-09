import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildInitialCollapsedWorkspaceIds, type WorkspaceMenuSection } from '../navigation';

export function useWorkspaceCollapse(
  sections: ReadonlyArray<WorkspaceMenuSection>,
  maxExpanded = 3,
) {
  const defaultCollapsedIds = useMemo(
    () => buildInitialCollapsedWorkspaceIds(sections, maxExpanded),
    [maxExpanded, sections],
  );
  const sectionIds = useMemo(() => sections.map((section) => section.id).join('\n'), [sections]);
  const [toggledWorkspaceIds, setToggledWorkspaceIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setToggledWorkspaceIds((current) => {
      const validIds = new Set(sectionIds.split('\n').filter((id) => id.length > 0));
      const next = new Set([...current].filter((id) => validIds.has(id)));
      return sameSet(current, next) ? current : next;
    });
  }, [sectionIds]);

  const collapsedWorkspaceIds = useMemo(
    () => applyWorkspaceCollapseToggles(defaultCollapsedIds, [...toggledWorkspaceIds]),
    [defaultCollapsedIds, toggledWorkspaceIds],
  );

  const toggleWorkspace = useCallback(
    (workspaceId: string) => {
      setToggledWorkspaceIds((current) => {
        const next = new Set(current);
        if (next.has(workspaceId)) next.delete(workspaceId);
        else next.add(workspaceId);
        return next;
      });
    },
    [],
  );

  return {
    collapsedWorkspaceIds,
    toggleWorkspace,
  };
}

export function applyWorkspaceCollapseToggles(
  defaultCollapsedIds: ReadonlyArray<string>,
  toggledWorkspaceIds: ReadonlyArray<string>,
): string[] {
  const collapsed = new Set(defaultCollapsedIds);
  for (const workspaceId of toggledWorkspaceIds) {
    if (collapsed.has(workspaceId)) collapsed.delete(workspaceId);
    else collapsed.add(workspaceId);
  }
  return [...collapsed];
}

function sameSet(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}
