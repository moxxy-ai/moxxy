import { AsyncLocalStorage } from 'node:async_hooks';
import { join } from 'node:path';
import {
  WorkflowApprovals,
  approvalFingerprint,
  withPermissionScope,
  claimWorkflowLease,
} from '@moxxy/core';
import type { Workflow, WorkflowApprovalScope } from '@moxxy/sdk';
import { moxxyPath } from '@moxxy/sdk/server';
import type { WorkflowStore } from '@moxxy/plugin-workflows';

export interface WorkflowApprovalExecution {
  run<T>(
    name: string,
    runId: string,
    signal: AbortSignal,
    task: (signal: AbortSignal) => Promise<T>,
  ): Promise<T>;
}

function definition(
  workflow: Workflow,
  store: WorkflowStore,
  visited = new Set<string>(),
): unknown {
  if (visited.has(workflow.name)) return { cycle: workflow.name };
  visited.add(workflow.name);
  const {
    name: _name,
    description: _description,
    on: _on,
    enabled: _enabled,
    ...execution
  } = workflow;
  return {
    execution,
    nested: workflow.steps
      .filter((step) => step.workflow)
      .map((step) => {
        const nested = step.workflow ? store.lookup(step.workflow) : undefined;
        return nested ? definition(nested, store, visited) : null;
      }),
  };
}

export function buildWorkflowApprovalExecution(
  cwd: string,
  store: WorkflowStore,
  approvalDir = join(moxxyPath('workflow-approvals'), approvalFingerprint(cwd)),
): {
  approvals: WorkflowApprovals;
  execution: WorkflowApprovalExecution;
} {
  const approvals = new WorkflowApprovals(approvalDir);
  const current = new AsyncLocalStorage<{ scope: WorkflowApprovalScope; signal: AbortSignal }>();
  const active = new Map<string, string>();
  return {
    approvals,
    execution: {
      async run(name, runId, signal, task) {
        await store.load();
        const entry = await store.get(name);
        if (!entry || !entry.workflow.enabled) throw new Error('Workflow is missing or disabled');
        const workflowId = approvalFingerprint([cwd, entry.path]);
        const inherited = current.getStore();
        if (inherited && inherited.scope.workflowId === workflowId)
          return task(AbortSignal.any([signal, inherited.signal]));
        if (active.has(workflowId))
          throw new Error(
            'Workflow execution skipped: another execution is running or awaiting approval',
          );
        const release = await claimWorkflowLease(join(approvalDir, 'leases'), workflowId, signal);
        try {
          const revision = approvalFingerprint(definition(entry.workflow, store));
          const scope = { workflowId, workflowName: name, revision, runId };
          const controller = new AbortController();
          const effectiveSignal = AbortSignal.any([signal, controller.signal]);
          active.set(workflowId, runId);
          const valid = async () => {
            // Approval may stay open while an external editor changes the YAML.
            // Re-read authoritative definitions, not only the UI's cached registry.
            await store.load();
            const updated = await store.get(name);
            return (
              !effectiveSignal.aborted &&
              !(await approvals.isCancelled(scope)) &&
              !!updated &&
              updated.workflow.enabled &&
              approvalFingerprint(definition(updated.workflow, store)) === revision
            );
          };
          let checking = false;
          const timer = setInterval(() => {
            if (checking) return;
            checking = true;
            void valid()
              .then((ok) => {
                if (!ok) controller.abort('Workflow changed or stopped');
              })
              .catch((error) => controller.abort(error))
              .finally(() => {
                checking = false;
              });
          }, 200);
          timer.unref();
          try {
            return await current.run({ scope, signal: effectiveSignal }, () =>
              withPermissionScope(
                {
                  name: 'workflow-scoped-approval',
                  check: async (call) => {
                    if (!(await valid()))
                      return { mode: 'deny', reason: 'Workflow changed, disabled or cancelled' };
                    return approvals.check(scope, call, effectiveSignal, valid);
                  },
                },
                () => task(effectiveSignal),
              ),
            );
          } finally {
            clearInterval(timer);
            controller.abort('Workflow ended');
            active.delete(workflowId);
            await approvals.finishRun(runId);
          }
        } finally {
          await release();
        }
      },
    },
  };
}
