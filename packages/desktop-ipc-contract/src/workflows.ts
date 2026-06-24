// ---------- Workflows ------------------------------------------------------

export interface WorkflowSummary {
  name: string;
  description: string;
  enabled: boolean;
  scope: string;
  steps: number;
  triggers: string;
  /** Session this workflow's triggered runs are pinned to (where they run +
   *  display), or null when unpinned. Optional for back-compat with older
   *  summary producers. */
  targetSessionId?: string | null;
  /** Resolved display name of `targetSessionId` (its session title), or null
   *  when unpinned or the bound session no longer exists. */
  targetSessionName?: string | null;
}

export interface WorkflowRun {
  ok: boolean;
  output: string;
  error?: string;
  steps: ReadonlyArray<{ id: string; status: string; error?: string }>;
  /** `paused` when the run parked on an `awaitInput` step — answer it with
   *  `workflows.resume(runId, reply)` (human-in-the-loop). */
  status?: 'completed' | 'paused' | 'failed';
  runId?: string;
}

/** Validation result for a draft workflow YAML (visual builder, phase 2). */
export interface WorkflowValidate {
  ok: boolean;
  errors: ReadonlyArray<string>;
}

/** Result of persisting a workflow from the builder. */
export interface WorkflowSave {
  name: string;
  scope: string;
  path: string;
}

/** One saved workflow's canonical YAML + on-disk metadata. */
export interface WorkflowDetail {
  name: string;
  scope: string;
  path: string;
  yaml: string;
}
