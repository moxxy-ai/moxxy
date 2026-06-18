import {
  workflowRunParamsSchema,
  workflowSetEnabledParamsSchema,
  workflowValidateDraftParamsSchema,
  workflowSaveParamsSchema,
  workflowGetRunParamsSchema,
  workflowResumeParamsSchema,
} from '../protocol.js';
import type { HandlerContext } from './context.js';

// Workflows (delegates to session.workflows if the plugin is loaded). The
// builder + resume slices are optional on the view (older hosts / pre-builder
// plugins lack them), so feature-check and throw a clear error rather than
// calling undefined.

export async function handleWorkflowList(ctx: HandlerContext): Promise<unknown[]> {
  const view = ctx.session.workflows;
  if (!view) return [];
  return [...(await view.list())];
}

export async function handleWorkflowSetEnabled(
  ctx: HandlerContext,
  raw: unknown,
): Promise<void> {
  const params = workflowSetEnabledParamsSchema.parse(raw);
  const view = ctx.session.workflows;
  if (!view) throw new Error('workflows plugin not loaded');
  await view.setEnabled(params.name, params.enabled);
}

export async function handleWorkflowRun(ctx: HandlerContext, raw: unknown): Promise<unknown> {
  const params = workflowRunParamsSchema.parse(raw);
  const view = ctx.session.workflows;
  if (!view) throw new Error('workflows plugin not loaded');
  return view.run(params.name);
}

export async function handleWorkflowValidateDraft(
  ctx: HandlerContext,
  raw: unknown,
): Promise<unknown> {
  const params = workflowValidateDraftParamsSchema.parse(raw);
  const view = ctx.session.workflows;
  if (!view?.validateDraft) throw new Error('workflows builder not supported on this runner');
  return view.validateDraft(params.yaml);
}

export async function handleWorkflowSave(ctx: HandlerContext, raw: unknown): Promise<unknown> {
  const params = workflowSaveParamsSchema.parse(raw);
  const view = ctx.session.workflows;
  if (!view?.save) throw new Error('workflows builder not supported on this runner');
  return view.save(params.yaml, params.previousName);
}

export async function handleWorkflowGetRun(ctx: HandlerContext, raw: unknown): Promise<unknown> {
  const params = workflowGetRunParamsSchema.parse(raw);
  const view = ctx.session.workflows;
  if (!view?.getRun) throw new Error('workflows builder not supported on this runner');
  return (await view.getRun(params.name)) ?? null;
}

// Workflows human-in-the-loop (resume a paused awaitInput run). v5. Optional on
// the view (older hosts lack it), so feature-check and throw a clear error
// rather than calling undefined.
export async function handleWorkflowResume(ctx: HandlerContext, raw: unknown): Promise<unknown> {
  const params = workflowResumeParamsSchema.parse(raw);
  const view = ctx.session.workflows;
  if (!view?.resume) throw new Error('workflow resume not supported on this runner');
  return view.resume(params.runId, params.reply);
}
