import { useCallback, useMemo, useState } from 'react';
import { filterWorkspaceMenuSections, type WorkspaceMenuSection } from '../navigation';

export function useMobileMenuSearch(sections: ReadonlyArray<WorkspaceMenuSection>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filteredSections = useMemo(() => filterWorkspaceMenuSections(sections, query), [sections, query]);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  return {
    open,
    query,
    filteredSections,
    setQuery,
    toggle,
    close,
  };
}
