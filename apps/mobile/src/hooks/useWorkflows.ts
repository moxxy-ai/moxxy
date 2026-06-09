import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, decodeError } from '@moxxy/client-core';
import { buildWorkflowListFrame, buildWorkflowRunFrame, invokeFrame } from '../clientFrames';

export interface MobileWorkflow {
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly scope: string;
  readonly steps: number;
  readonly triggers: string;
}

/**
 * Workflows over `workflows.list` / `workflows.run`. The host returns the
 * typed empty list when the workflows plugin isn't loaded, and `run` fails
 * with the coded `not-supported` error — both degrade to an empty screen and
 * a plain message instead of a crash.
 */
export function useWorkflows(input: {
  readonly ready: boolean;
  readonly refreshTick: number;
  readonly onError: (message: string) => void;
}) {
  const [list, setList] = useState<ReadonlyArray<Record<string, unknown>>>([]);
  const { ready, refreshTick, onError } = input;

  const refresh = useCallback(() => {
    if (!ready) return;
    void invokeFrame(api(), buildWorkflowListFrame())
      .then((summaries) => setList(summaries.map((summary) => ({ ...summary }))))
      .catch(() => setList([]));
  }, [ready]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshTick]);

  const run = useCallback(
    (name: string) => {
      void invokeFrame(api(), buildWorkflowRunFrame({ name }))
        .then((result) => {
          if (!result.ok) onError(result.error ?? `Workflow ${name} failed`);
        })
        .catch((e) => {
          const decoded = decodeError(e);
          onError(
            decoded.code === 'not-supported'
              ? 'Workflows are not available on this host.'
              : decoded.message,
          );
        });
    },
    [onError],
  );

  const workflows = useMemo(() => list.map(normalizeWorkflow), [list]);

  return {
    /** Raw records — feed `MobileState.workflows`. */
    list,
    workflows,
    refresh,
    run,
  };
}

function normalizeWorkflow(value: Record<string, unknown>, index: number): MobileWorkflow {
  return {
    name: textOf(value.name, `workflow-${index + 1}`),
    description: textOf(value.description, ''),
    enabled: value.enabled === true,
    scope: textOf(value.scope, ''),
    steps: typeof value.steps === 'number' ? value.steps : 0,
    triggers: textOf(value.triggers, ''),
  };
}

function textOf(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}
