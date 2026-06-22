import { useCallback, useMemo } from 'react';
import { buildWorkflowListFrame, buildWorkflowRunFrame } from '../clientFrames';
import type { MobileState } from '../protocol';
import type { MobileWorkflow } from './useMobileWorkflows';
export type { MobileWorkflow } from './useMobileWorkflows';

export function useWorkflows(
  state: MobileState,
  sendFrame: (frame: Record<string, unknown>) => void,
) {
  const workflows = useMemo(() => state.workflows.map(normalizeWorkflow), [state.workflows]);
  const refresh = useCallback(() => {
    sendFrame(buildWorkflowListFrame({ workspaceId: state.activeWorkspaceId }));
  }, [sendFrame, state.activeWorkspaceId]);
  const run = useCallback((name: string) => {
    sendFrame(buildWorkflowRunFrame({ workspaceId: state.activeWorkspaceId, name }));
  }, [sendFrame, state.activeWorkspaceId]);

  return {
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
