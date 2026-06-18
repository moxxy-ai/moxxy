import { type WorkflowsView } from '@moxxy/sdk';
import {
  type WorkflowStore,
  parseWorkflowYaml,
  serializeWorkflow,
} from '@moxxy/plugin-workflows';
import type { WorkflowRunner } from './build-workflow-runner.js';

/** Compact, human-readable summary of a workflow's `on:` trigger block. */
export function triggerSummary(on: import('@moxxy/sdk').WorkflowTrigger | undefined): string {
  if (!on) return 'on-demand';
  const parts: string[] = [];
  if (on.schedule?.cron) parts.push(`cron(${on.schedule.cron})`);
  if (on.schedule?.runAt) parts.push('runAt');
  if (on.afterWorkflow) parts.push(`after(${[on.afterWorkflow].flat().join(',')})`);
  if (on.fileChanged) parts.push('fileChanged');
  if (on.webhook) parts.push(`webhook(${on.webhook})`);
  return parts.length > 0 ? parts.join('+') : 'on-demand';
}

/**
 * Build the `/workflows` modal view: list/run/enable plus the builder-facing
 * draft validate / save / getRun / resume operations. All share the one
 * {@link WorkflowStore} and the {@link WorkflowRunner}, and re-sync schedules
 * via the injected `syncSchedules` after any mutation.
 */
export function buildWorkflowsView(args: {
  store: WorkflowStore;
  runner: WorkflowRunner;
  syncSchedules: () => Promise<void>;
}): WorkflowsView {
  const { store, runner, syncSchedules } = args;
  return {
    list: async () =>
      (await store.list()).map((w) => ({
        name: w.workflow.name,
        description: w.workflow.description,
        enabled: w.workflow.enabled,
        scope: w.scope,
        steps: w.workflow.steps.length,
        triggers: triggerSummary(w.workflow.on),
      })),
    setEnabled: async (name, enabled) => {
      await store.setEnabled(name, enabled);
      await syncSchedules();
    },
    run: async (name) => {
      const r = await runner.runNow({ name, trigger: 'manual' });
      return {
        ok: r.ok,
        output: r.output,
        ...(r.error ? { error: r.error } : {}),
        steps: r.steps.map((s) => ({ id: s.id, status: s.status, ...(s.error ? { error: s.error } : {}) })),
        status: r.status,
        ...(r.runId ? { runId: r.runId } : {}),
      };
    },
    // Builder-facing additions (phase 2 GUI): validate a draft YAML, persist a
    // workflow, and fetch one as canonical YAML. Keep them on the same store so
    // the modal and the builder share one source of truth.
    validateDraft: async (yaml) => {
      const r = parseWorkflowYaml(yaml);
      return { ok: r.ok, errors: r.errors };
    },
    save: async (yaml, previousName) => {
      const parsed = parseWorkflowYaml(yaml);
      if (!parsed.ok || !parsed.workflow) {
        throw new Error(`invalid workflow YAML — ${parsed.errors.join('; ')}`);
      }
      const saved = await store.save(parsed.workflow, previousName);
      await syncSchedules();
      return { name: saved.workflow.name, scope: saved.scope, path: saved.path };
    },
    getRun: async (name) => {
      const entry = await store.get(name);
      if (!entry) return null;
      return {
        name: entry.workflow.name,
        scope: entry.scope,
        path: entry.path,
        yaml: serializeWorkflow(entry.workflow),
      };
    },
    // Human-in-the-loop: answer a paused run's awaitInput question and resume.
    resume: async (runId, reply) => {
      const r = await runner.resumeNow(runId, reply);
      return {
        ok: r.ok,
        output: r.output,
        ...(r.error ? { error: r.error } : {}),
        steps: r.steps.map((s) => ({ id: s.id, status: s.status, ...(s.error ? { error: s.error } : {}) })),
        status: r.status,
        ...(r.runId ? { runId: r.runId } : {}),
      };
    },
  };
}
