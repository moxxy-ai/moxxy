/**
 * Validation + save bridges over the workflows IPC (`workflows.validateDraft` /
 * `workflows.save`), plus the pure error-mapping that turns the host's flat
 * `string[]` issues into a per-node bucket the inspector highlights.
 *
 * The transport is injected (not imported) so this module stays DOM-free and
 * platform-neutral: the desktop passes `window.moxxy.invoke`, the mobile app
 * passes its frame-bridge `invokeFrame`-wrapped invoker. Each issue line the
 * host returns is scanned for a `step "<id>"` mention; matches bucket under
 * that node id, everything else falls into {@link WORKFLOW_ERROR_KEY}.
 */

import { assertDefined } from './assert.js';
import type { BuilderState } from './types.js';
import { WORKFLOW_ERROR_KEY } from './types.js';
import { serialize } from './serialize.js';

/** Minimal validate result shape (matches `WorkflowValidate` in the contract). */
export interface ValidateResult {
  readonly ok: boolean;
  readonly errors: ReadonlyArray<string>;
}

/** Minimal save result shape (matches `WorkflowSave` in the contract). */
export interface SaveResult {
  readonly name: string;
  readonly scope: string;
  readonly path: string;
}

/** The host call surface the bridges need — implemented per platform. */
export interface BuilderBridge {
  validateDraft(yaml: string): Promise<ValidateResult>;
  save(yaml: string): Promise<SaveResult>;
}

/**
 * Validate the current canvas: serialize → call the host → map issues back
 * onto nodes. Returns the raw result plus the per-node error buckets so a
 * caller can both surface a banner and decorate nodes.
 */
export async function validate(
  bridge: BuilderBridge,
  state: BuilderState,
): Promise<{ result: ValidateResult; errors: Record<string, string[]> }> {
  const { yaml } = serialize(state);
  const result = await bridge.validateDraft(yaml);
  return { result, errors: mapErrorsToNodes(result.errors, state) };
}

/**
 * Persist the canvas after a successful validation. Throws if validation fails
 * (the host's `save` would reject anyway, but failing here yields the mapped
 * per-node errors for the UI). On success the caller should mark the state
 * clean and refresh the list.
 */
export async function save(
  bridge: BuilderBridge,
  state: BuilderState,
): Promise<{ result: SaveResult; yaml: string }> {
  const { yaml } = serialize(state);
  const validation = await bridge.validateDraft(yaml);
  if (!validation.ok) {
    throw new ValidationError('workflow has validation errors', validation.errors, mapErrorsToNodes(validation.errors, state));
  }
  const result = await bridge.save(yaml);
  return { result, yaml };
}

/** Thrown by {@link save} when the draft fails validation. */
export class ValidationError extends Error {
  constructor(
    message: string,
    readonly issues: ReadonlyArray<string>,
    readonly byNode: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

const STEP_MENTION_RE = /step "([^"]+)"/g;
const DUP_RE = /duplicate step id "([^"]+)"/;

/**
 * Bucket each flat issue line under the node id(s) it names. A line that
 * mentions `step "x"` is attached to node `x` (and to any other step it
 * names, e.g. "step a needs unknown step b" — the author edits `a`). Lines
 * with no recognizable step reference land in {@link WORKFLOW_ERROR_KEY}.
 */
export function mapErrorsToNodes(
  issues: ReadonlyArray<string>,
  state: BuilderState,
): Record<string, string[]> {
  const known = new Set(state.nodes.map((n) => n.id));
  const out: Record<string, string[]> = {};
  const push = (key: string, msg: string): void => {
    (out[key] ??= []).push(msg);
  };

  for (const issue of issues) {
    const mentioned = new Set<string>();
    const dup = DUP_RE.exec(issue);
    if (dup) {
      const dupId = dup[1];
      assertDefined(dupId, 'DUP_RE has a mandatory capture group');
      if (known.has(dupId)) mentioned.add(dupId);
    }
    let m: RegExpExecArray | null;
    STEP_MENTION_RE.lastIndex = 0;
    while ((m = STEP_MENTION_RE.exec(issue))) {
      const stepId = m[1];
      assertDefined(stepId, 'STEP_MENTION_RE has a mandatory capture group');
      if (known.has(stepId)) mentioned.add(stepId);
    }
    if (mentioned.size === 0) {
      push(WORKFLOW_ERROR_KEY, issue);
    } else {
      // Attribute to the FIRST named step (the one whose definition is wrong);
      // additional mentions are usually the unknown target the author must add.
      const [first] = [...mentioned];
      assertDefined(first, 'mentioned is non-empty in this branch');
      push(first, issue);
    }
  }
  return out;
}
