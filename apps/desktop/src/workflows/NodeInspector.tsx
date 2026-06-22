import { useEffect, useState } from 'react';
import { TextArea, TextInput } from '@moxxy/desktop-ui';
import {
  stepKindMeta,
  type BuilderAction,
  type BuilderNode,
  type BuilderState,
} from '@moxxy/workflows-builder';
import type { WorkflowStepErrorMode } from '@moxxy/sdk';
import type { ActionCatalog } from '@moxxy/client-core';
import { accentHex } from './accents';

/**
 * The right-hand inspector for the selected node. It edits the step's action
 * field (the one matching its kind) plus the shared fields (label, needs,
 * onError/retries). For branch + loop kinds it surfaces the structural editors:
 *   - condition → then/else target multi-select
 *   - switch    → per-case target lists + default
 *   - loop      → BODY membership (which steps run inside), the EXIT target (the
 *                 single "on done / on error → next" step), the EXIT/GOAL
 *                 condition prompt, and maxIterations.
 *
 * All mutations go through the shared reducer; this component is presentation +
 * interaction only.
 */

interface Props {
  readonly state: BuilderState;
  readonly node: BuilderNode;
  readonly dispatch: (action: BuilderAction) => void;
  /** Live skills/tools registry snapshot for the name pickers. Optional so the
   *  inspector degrades to free-text fields when no session is attached yet. */
  readonly catalog?: ActionCatalog;
}

const ERROR_MODES: WorkflowStepErrorMode[] = ['fail', 'continue', 'retry'];

export function NodeInspector({ state, node, dispatch, catalog }: Props): JSX.Element {
  const meta = stepKindMeta(node.kind);
  const accent = accentHex(meta.accent);
  const otherNodes = state.nodes.filter((n) => n.id !== node.id);
  const errors = state.errors[node.id] ?? [];

  const patch = (p: Parameters<typeof dispatchUpdate>[2]): void => dispatchUpdate(dispatch, node.id, p);

  return (
    <aside
      data-testid="node-inspector"
      style={{
        width: 320,
        flexShrink: 0,
        overflowY: 'auto',
        borderLeft: '1px solid var(--color-border)',
        background: 'var(--color-bg-card)',
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: accent }}>
          {meta.label}
        </span>
        <button
          type="button"
          data-testid="delete-node"
          onClick={() => dispatch({ type: 'remove-step', id: node.id })}
          style={pillBtn('var(--color-red)')}
        >
          Delete
        </button>
      </header>

      <IdField state={state} node={node} dispatch={dispatch} />
      <Field label="Label">
        <TextInput
          value={node.label ?? ''}
          placeholder="Human title"
          onChange={(e) => patch({ label: e.target.value })}
          data-testid="field-label"
        />
      </Field>

      {renderAction(node, dispatch, patch, catalog)}

      {node.kind === 'condition' && (
        <>
          <TargetPicker
            label="then → (condition met)"
            options={otherNodes}
            selected={node.then ?? []}
            onChange={(targets) => dispatch({ type: 'set-branch', nodeId: node.id, slot: 'then', targets })}
            testid="branch-then"
          />
          <TargetPicker
            label="else → (condition not met)"
            options={otherNodes}
            selected={node.else ?? []}
            onChange={(targets) => dispatch({ type: 'set-branch', nodeId: node.id, slot: 'else', targets })}
            testid="branch-else"
          />
        </>
      )}

      {node.kind === 'switch' && <SwitchEditor node={node} options={otherNodes} dispatch={dispatch} />}

      {node.kind === 'loop' && <LoopEditor state={state} node={node} dispatch={dispatch} />}

      {node.kind !== 'loop' && (
        <NeedsPicker node={node} options={otherNodes} dispatch={dispatch} />
      )}

      <Field label="On error">
        <select
          value={node.onError}
          data-testid="field-onerror"
          onChange={(e) => patch({ onError: e.target.value as WorkflowStepErrorMode })}
          style={selectStyle}
        >
          {ERROR_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </Field>
      {node.onError === 'retry' && (
        <Field label="Retries (0-3)">
          <TextInput
            type="number"
            value={String(node.retries)}
            onChange={(e) => patch({ retries: Number(e.target.value) })}
            data-testid="field-retries"
          />
        </Field>
      )}

      {(node.kind === 'prompt' || node.kind === 'skill') && (
        <label style={checkboxRow}>
          <input
            type="checkbox"
            checked={node.awaitInput ?? false}
            onChange={(e) => patch({ awaitInput: e.target.checked })}
            data-testid="field-awaitinput"
          />
          Await operator input
        </label>
      )}

      {errors.length > 0 && (
        <div data-testid="node-errors" style={errorBox}>
          {errors.map((msg, i) => (
            <div key={i}>{msg}</div>
          ))}
        </div>
      )}
    </aside>
  );
}

function renderAction(
  node: BuilderNode,
  _dispatch: (a: BuilderAction) => void,
  patch: (p: Parameters<typeof dispatchUpdate>[2]) => void,
  catalog?: ActionCatalog,
): JSX.Element | null {
  switch (node.kind) {
    case 'prompt':
      return (
        <Field label="Prompt">
          <TextArea rows={5} value={node.action} onChange={(e) => patch({ action: e.target.value })} data-testid="field-action" />
        </Field>
      );
    case 'bridge':
    case 'condition':
    case 'switch':
      return (
        <Field label="Instruction">
          <TextArea rows={4} value={node.action} onChange={(e) => patch({ action: e.target.value })} data-testid="field-action" />
        </Field>
      );
    case 'skill':
      return (
        <>
          <ActionNamePicker
            kind="skill"
            value={node.action}
            onChange={(action) => patch({ action })}
            catalog={catalog}
          />
          <Field label="Input">
            <TextArea rows={3} value={node.input ?? ''} onChange={(e) => patch({ input: e.target.value })} data-testid="field-input" />
          </Field>
        </>
      );
    case 'tool':
    case 'workflow':
      return (
        <>
          {node.kind === 'tool' ? (
            <ActionNamePicker
              kind="tool"
              value={node.action}
              onChange={(action) => patch({ action })}
              catalog={catalog}
            />
          ) : (
            <Field label="Workflow name">
              <TextInput value={node.action} onChange={(e) => patch({ action: e.target.value })} data-testid="field-action" />
            </Field>
          )}
          <ArgsField nodeId={node.id} args={node.args} onChange={(args) => patch({ args })} />
        </>
      );
    case 'loop':
      return null; // handled by LoopEditor
  }
}

/**
 * Step-id editor. Fully-controlled-by-`node.id` would make the field
 * un-clearable: `renameNode` is a no-op on an empty or already-taken `to`, so
 * clearing the field to retype snaps straight back to the old id mid-edit. Like
 * {@link ArgsField}, it keeps a local draft the user types into freely and only
 * dispatches `rename-node` when the draft is a non-empty, unique id; an inline
 * hint shows while the draft is invalid. The draft re-seeds whenever the node's
 * committed id changes (selection change or an accepted rename).
 */
function IdField({
  state,
  node,
  dispatch,
}: {
  state: BuilderState;
  node: BuilderNode;
  dispatch: (a: BuilderAction) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(node.id);

  useEffect(() => {
    setDraft(node.id);
  }, [node.id]);

  const trimmed = draft.trim();
  const taken = trimmed !== node.id && state.nodes.some((n) => n.id === trimmed);
  const invalid = trimmed === '' || taken;

  return (
    <Field label="Step id">
      <TextInput
        value={draft}
        data-testid="field-id"
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          const nextTrimmed = next.trim();
          if (nextTrimmed !== '' && nextTrimmed !== node.id && !state.nodes.some((n) => n.id === nextTrimmed)) {
            dispatch({ type: 'rename-node', from: node.id, to: nextTrimmed });
          }
        }}
        onBlur={() => setDraft(node.id)}
      />
      {invalid && (
        <span data-testid="field-id-invalid" style={{ ...emptyHint, color: 'var(--color-red)' }}>
          {trimmed === '' ? 'Id can’t be empty.' : `Id “${trimmed}” is already used.`}
        </span>
      )}
    </Field>
  );
}

/** Keys that pollute Object.prototype when spread/assigned downstream. The args
 *  are serialized into workflow YAML and ultimately spread into a tool
 *  invocation on the runner; strip them here, at the trust boundary that first
 *  accepts this free-text, as defense-in-depth. */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Recursively drop prototype-pollution keys from a freshly-parsed JSON value. */
function stripDangerousKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripDangerousKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DANGEROUS_KEYS.has(k)) continue;
      out[k] = stripDangerousKeys(v);
    }
    return out;
  }
  return value;
}

/**
 * Args (JSON) editor. The textarea is uncontrolled-by-draft: it renders a local
 * string the user types into, parsing on every change and only committing the
 * parsed object when it's valid JSON. This lets the user pass through invalid
 * intermediate states (a half-typed key, a deleted brace) without the field
 * snapping back to the last-valid pretty-print. The draft re-seeds from the
 * node's args only when the selected node changes (node.id).
 */
function ArgsField({
  nodeId,
  args,
  onChange,
}: {
  nodeId: string;
  args?: Record<string, unknown>;
  onChange: (args: Record<string, unknown>) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(() => JSON.stringify(args ?? {}, null, 2));
  const [invalid, setInvalid] = useState(false);

  // Re-seed from the node only when the selection changes, so committing a valid
  // edit (which re-renders with new args) doesn't clobber what the user is typing.
  useEffect(() => {
    setDraft(JSON.stringify(args ?? {}, null, 2));
    setInvalid(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  return (
    <Field label="Args (JSON)">
      <TextArea
        rows={3}
        value={draft}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          try {
            const parsed = JSON.parse(next) as unknown;
            // Only commit JSON objects; reject arrays/primitives (args is a map)
            // and strip prototype-pollution keys before forwarding to the runner.
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              setInvalid(true);
              return;
            }
            onChange(stripDangerousKeys(parsed) as Record<string, unknown>);
            setInvalid(false);
          } catch {
            // Keep the keystrokes in the draft; just don't commit invalid JSON.
            setInvalid(true);
          }
        }}
        data-testid="field-args"
      />
      {invalid && (
        <span data-testid="field-args-invalid" style={{ ...emptyHint, color: 'var(--color-red)' }}>
          Invalid JSON — fix to save.
        </span>
      )}
    </Field>
  );
}

/**
 * The skill/tool name field. With a loaded catalog it's a dropdown of what the
 * session actually has registered (a saved name that no longer exists stays
 * selectable, marked "(not installed)", so loading an old workflow never
 * silently rewrites it); an empty catalog states that plainly and leaves a
 * free-text field for forward-authoring; no catalog (no session attached yet)
 * keeps the plain text field.
 */
function ActionNamePicker({
  kind,
  value,
  onChange,
  catalog,
}: {
  kind: 'skill' | 'tool';
  value: string;
  onChange: (value: string) => void;
  catalog?: ActionCatalog;
}): JSX.Element {
  const label = kind === 'skill' ? 'Skill name' : 'Tool name';
  if (!catalog?.loaded) {
    return (
      <Field label={label}>
        <TextInput value={value} onChange={(e) => onChange(e.target.value)} data-testid="field-action" />
      </Field>
    );
  }
  const items: ReadonlyArray<{ name: string; description?: string }> =
    kind === 'skill' ? catalog.skills : catalog.tools;
  if (items.length === 0) {
    return (
      <Field label={label}>
        <span data-testid="catalog-empty" style={emptyHint}>
          {kind === 'skill'
            ? 'No skills are currently available. Add one (e.g. via /skills or ~/.moxxy/skills), then pick it here.'
            : 'No tools are currently available. Enable a plugin that provides tools, then pick one here.'}
        </span>
        <TextInput value={value} onChange={(e) => onChange(e.target.value)} data-testid="field-action" />
      </Field>
    );
  }
  const known = items.some((i) => i.name === value);
  const description = items.find((i) => i.name === value)?.description;
  return (
    <Field label={label}>
      <select
        value={value}
        data-testid="field-action"
        onChange={(e) => onChange(e.target.value)}
        style={selectStyle}
      >
        {value === '' && <option value="">Select a {kind}…</option>}
        {!known && value !== '' && <option value={value}>{value} (not installed)</option>}
        {items.map((i) => (
          <option key={i.name} value={i.name} title={i.description}>
            {i.name}
          </option>
        ))}
      </select>
      {description && (
        <span data-testid="action-description" style={emptyHint}>
          {description}
        </span>
      )}
    </Field>
  );
}

function LoopEditor({
  state,
  node,
  dispatch,
}: {
  state: BuilderState;
  node: BuilderNode;
  dispatch: (a: BuilderAction) => void;
}): JSX.Element {
  const candidates = state.nodes.filter((n) => n.id !== node.id);
  const body = node.loop?.body ?? [];
  const exit = state.edges.find((e) => e.kind === 'loop-exit' && e.from === node.id)?.to ?? '';
  const bodySet = new Set(body);
  return (
    <>
      <Field label="EXIT / GOAL condition (met → stop the loop)">
        <TextArea
          rows={3}
          value={node.loop?.condition ?? ''}
          placeholder="Describe the goal that ENDS the loop."
          onChange={(e) => dispatch({ type: 'set-loop-config', loopId: node.id, patch: { condition: e.target.value } })}
          data-testid="loop-condition"
        />
      </Field>
      <Field label="Max iterations (1-50)">
        <TextInput
          type="number"
          value={String(node.loop?.maxIterations ?? 10)}
          onChange={(e) =>
            dispatch({ type: 'set-loop-config', loopId: node.id, patch: { maxIterations: Number(e.target.value) } })
          }
          data-testid="loop-max"
        />
      </Field>
      <Field label="Body — steps that run INSIDE the loop, each iteration">
        <div data-testid="loop-body" style={pickList}>
          {candidates.length === 0 && <span style={emptyHint}>Add steps, then assign them here.</span>}
          {candidates.map((c) => (
            <label key={c.id} style={pickRow}>
              <input
                type="checkbox"
                checked={bodySet.has(c.id)}
                disabled={c.id === exit}
                onChange={(e) => {
                  const next = e.target.checked ? [...body, c.id] : body.filter((b) => b !== c.id);
                  dispatch({ type: 'set-loop-body', loopId: node.id, body: next });
                }}
              />
              {c.label || c.id}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Exit → next step (on done / on body error)">
        <select
          value={exit}
          data-testid="loop-exit"
          onChange={(e) => dispatch({ type: 'set-loop-exit', loopId: node.id, targetId: e.target.value || null })}
          style={selectStyle}
        >
          <option value="">(loop ends the workflow)</option>
          {candidates
            .filter((c) => !bodySet.has(c.id))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.label || c.id}
              </option>
            ))}
        </select>
      </Field>
    </>
  );
}

/** Slugify a free-text case id the same way step ids are normalised
 *  (mirrors `uniqueId`'s slug rule in @moxxy/workflows-builder). Returns '' for
 *  input that slugs to nothing, so the caller can reject it. */
function slugCaseId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

function SwitchEditor({
  node,
  options,
  dispatch,
}: {
  node: BuilderNode;
  options: BuilderNode[];
  dispatch: (a: BuilderAction) => void;
}): JSX.Element {
  const cases = node.cases ?? {};
  // Inline "new case id" field. window.prompt() is unsupported in Electron's
  // renderer (it throws), so the add path is a controlled text input that
  // dispatches set-case on submit, slugifying + de-duping the id like step ids.
  const [draft, setDraft] = useState('');
  const slug = slugCaseId(draft);
  const duplicate = slug !== '' && Object.prototype.hasOwnProperty.call(cases, slug);
  const canAdd = slug !== '' && !duplicate;
  const addCase = (): void => {
    if (!canAdd) return;
    dispatch({ type: 'set-case', nodeId: node.id, caseId: slug, targets: [] });
    setDraft('');
  };
  return (
    <>
      {Object.entries(cases).map(([caseId, targets]) => (
        <div key={caseId} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={fieldLabel}>case · {caseId}</span>
            <button
              type="button"
              aria-label={`Remove case ${caseId}`}
              onClick={() => dispatch({ type: 'remove-case', nodeId: node.id, caseId })}
              style={pillBtn('var(--color-text-dim)')}
            >
              remove
            </button>
          </div>
          <TargetPicker
            label=""
            options={options}
            selected={targets}
            onChange={(t) => dispatch({ type: 'set-case', nodeId: node.id, caseId, targets: t })}
            testid={`case-${caseId}`}
          />
        </div>
      ))}
      <Field label="New case id">
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <TextInput
            value={draft}
            placeholder='e.g. "high"'
            data-testid="add-case-input"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCase();
              }
            }}
          />
          <button
            type="button"
            data-testid="add-case"
            disabled={!canAdd}
            aria-label="Add switch case"
            onClick={addCase}
            style={{ ...pillBtn('var(--color-primary)'), opacity: canAdd ? 1 : 0.5 }}
          >
            + Add case
          </button>
        </div>
        {duplicate && (
          <span data-testid="add-case-invalid" style={{ ...emptyHint, color: 'var(--color-red)' }}>
            A case “{slug}” already exists.
          </span>
        )}
      </Field>
      <TargetPicker
        label="default →"
        options={options}
        selected={node.default ?? []}
        onChange={(t) => dispatch({ type: 'set-branch', nodeId: node.id, slot: 'default', targets: t })}
        testid="switch-default"
      />
    </>
  );
}

function NeedsPicker({
  node,
  options,
  dispatch,
}: {
  node: BuilderNode;
  options: BuilderNode[];
  dispatch: (a: BuilderAction) => void;
}): JSX.Element {
  const set = new Set(node.needs);
  return (
    <Field label="Needs (upstream dependencies)">
      <div data-testid="needs-picker" style={pickList}>
        {options.length === 0 && <span style={emptyHint}>No other steps yet.</span>}
        {options.map((o) => (
          <label key={o.id} style={pickRow}>
            <input
              type="checkbox"
              checked={set.has(o.id)}
              onChange={(e) =>
                dispatch(
                  e.target.checked
                    ? { type: 'connect-needs', from: o.id, to: node.id }
                    : { type: 'disconnect-needs', from: o.id, to: node.id },
                )
              }
            />
            {o.label || o.id}
          </label>
        ))}
      </div>
    </Field>
  );
}

function TargetPicker({
  label,
  options,
  selected,
  onChange,
  testid,
}: {
  label: string;
  options: BuilderNode[];
  selected: ReadonlyArray<string>;
  onChange: (targets: string[]) => void;
  testid: string;
}): JSX.Element {
  const set = new Set(selected);
  return (
    <Field label={label}>
      <div data-testid={testid} style={pickList}>
        {options.map((o) => (
          <label key={o.id} style={pickRow}>
            <input
              type="checkbox"
              checked={set.has(o.id)}
              onChange={(e) =>
                onChange(e.target.checked ? [...selected, o.id] : selected.filter((s) => s !== o.id))
              }
            />
            {o.label || o.id}
          </label>
        ))}
      </div>
    </Field>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && <span style={fieldLabel}>{label}</span>}
      {children}
    </label>
  );
}

function dispatchUpdate(
  dispatch: (a: BuilderAction) => void,
  id: string,
  patch: {
    label?: string;
    action?: string;
    input?: string;
    args?: Record<string, unknown>;
    onError?: WorkflowStepErrorMode;
    retries?: number;
    awaitInput?: boolean;
  },
): void {
  dispatch({ type: 'update-node', id, patch });
}

const fieldLabel: React.CSSProperties = {
  fontSize: '0.65rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  color: 'var(--color-text-dim)',
};

const selectStyle: React.CSSProperties = {
  padding: '0.4rem 0.5rem',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-block)',
  background: 'var(--color-bg-card)',
  fontSize: '0.82rem',
};

const pickList: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  maxHeight: 160,
  overflowY: 'auto',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-block)',
  padding: '0.4rem 0.5rem',
};

const pickRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: '0.78rem',
  color: 'var(--color-text)',
};

const checkboxRow: React.CSSProperties = { ...pickRow, fontWeight: 500 };

const emptyHint: React.CSSProperties = { fontSize: '0.75rem', color: 'var(--color-text-dim)' };

const errorBox: React.CSSProperties = {
  fontSize: '0.72rem',
  color: 'var(--color-red)',
  background: 'color-mix(in oklab, var(--color-red) 8%, transparent)',
  border: '1px solid var(--color-red)',
  borderRadius: 'var(--radius-block)',
  padding: '0.45rem 0.55rem',
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
};

function pillBtn(color: string): React.CSSProperties {
  return {
    fontSize: '0.68rem',
    fontWeight: 600,
    padding: '0.2rem 0.55rem',
    color: 'var(--color-bg)',
    background: color,
    borderRadius: 'var(--radius-block)',
  };
}
