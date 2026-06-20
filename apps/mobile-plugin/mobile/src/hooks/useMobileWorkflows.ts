import type { UseWorkflows } from '@moxxy/client-core';
import { useCallback, useMemo } from 'react';

type WorkflowSummary = UseWorkflows['list'][number];

export interface MobileWorkflow {
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly scope: string;
  readonly steps: number;
  readonly triggers: string;
}

const EMPTY_WORKFLOWS: ReadonlyArray<MobileWorkflow> = Object.freeze([]);
const noop = () => undefined;

export const disconnectedMobileWorkflowStore = Object.freeze({
  workflows: EMPTY_WORKFLOWS,
  refresh: noop,
  run: noop,
});

export function useMobileWorkflows(core: UseWorkflows) {
  const workflows = useMemo(() => core.list.map(normalizeMobileWorkflow), [core.list]);
  const refresh = useCallback(() => {
    void core.refresh();
  }, [core.refresh]);
  const run = useCallback(
    (name: string) => {
      void core.run(name);
    },
    [core.run],
  );

  return useMemo(
    () => ({
      workflows,
      refresh,
      run,
    }),
    [refresh, run, workflows],
  );
}

function normalizeMobileWorkflow(value: WorkflowSummary): MobileWorkflow {
  return {
    name: value.name,
    description: value.description,
    enabled: value.enabled,
    scope: value.scope,
    steps: value.steps,
    triggers: value.triggers,
  };
}
