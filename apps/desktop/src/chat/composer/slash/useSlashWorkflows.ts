import { useEffect, useState } from 'react';
import { api } from '@moxxy/client-core';
import type { SlashWorkflow } from './slash-commands';

/**
 * The workflows the slash menu offers, read each time the menu is wanted so
 * one made or switched off a moment ago is right. A run without the workflows
 * plugin has none.
 */
export function useSlashWorkflows(wanted: boolean): ReadonlyArray<SlashWorkflow> {
  const [workflows, setWorkflows] = useState<ReadonlyArray<SlashWorkflow>>([]);
  useEffect(() => {
    if (!wanted) return undefined;
    let cancelled = false;
    void api()
      .invoke('workflows.list')
      .then((list) => {
        if (!cancelled && Array.isArray(list)) setWorkflows(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [wanted]);
  return workflows;
}
