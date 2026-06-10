import { useEffect } from 'react';
import { useWorkflowBuilder } from '@moxxy/client-core';
import { TextInput } from '@moxxy/desktop-ui';
import { WORKFLOW_ERROR_KEY } from '@moxxy/workflows-builder';
import { WorkflowCanvas } from './WorkflowCanvas';
import { NodeInspector } from './NodeInspector';
import { Palette } from './Palette';

/**
 * The desktop visual builder: palette + drag canvas + node inspector, all
 * driven by the shared `useWorkflowBuilder` hook (state/logic) so this layer is
 * rendering + interaction only. Live-validates on edit (errors decorate nodes
 * + the inspector); Save runs validateDraft → save through the IPC.
 *
 * `name === null` opens a blank canvas (new workflow); a name loads that
 * workflow's YAML via `workflows.getRun` and hydrates the canvas.
 */
interface Props {
  readonly name: string | null;
  readonly onClose: () => void;
  /** Called after a successful save so the list refreshes. */
  readonly onSaved: () => void;
}

export function WorkflowBuilder({ name, onClose, onSaved }: Props): JSX.Element {
  const builder = useWorkflowBuilder();
  const { state, dispatch } = builder;

  useEffect(() => {
    void builder.load(name);
    // load identity is stable per hook; re-run only when the target changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const selectedNode = state.nodes.find((n) => n.id === state.selected) ?? null;
  const workflowErrors = state.errors[WORKFLOW_ERROR_KEY] ?? [];

  const onSave = async (): Promise<void> => {
    const result = await builder.save();
    if (result) onSaved();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '0.75rem 1rem',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <button type="button" data-testid="builder-back" onClick={onClose} style={ghostBtn}>
          ← Back
        </button>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 220 }}>
          <span style={metaLabel}>workflow name (slug)</span>
          <TextInput
            value={state.meta.name}
            data-testid="builder-name"
            onChange={(e) => dispatch({ type: 'update-meta', patch: { name: e.target.value } })}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <span style={metaLabel}>description</span>
          <TextInput
            value={state.meta.description}
            data-testid="builder-description"
            onChange={(e) => dispatch({ type: 'update-meta', patch: { description: e.target.value } })}
          />
        </div>
        <ValidityBadge valid={builder.valid} validating={builder.validating} />
        <button
          type="button"
          data-testid="builder-save"
          disabled={builder.saving || builder.valid === false}
          onClick={() => void onSave()}
          style={{
            ...primaryBtn,
            opacity: builder.saving || builder.valid === false ? 0.5 : 1,
          }}
        >
          {builder.saving ? 'Saving…' : 'Save'}
        </button>
      </header>

      <div style={{ padding: '0.6rem 1rem' }}>
        <Palette dispatch={dispatch} />
      </div>

      {builder.error && (
        <p role="alert" data-testid="builder-error" style={alertBox}>
          {builder.error}
        </p>
      )}
      {workflowErrors.length > 0 && (
        <div data-testid="builder-workflow-errors" style={{ ...alertBox, flexDirection: 'column' }}>
          {workflowErrors.map((msg, i) => (
            <div key={i}>{msg}</div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 0, padding: '0 1rem 1rem' }}>
        <WorkflowCanvas state={state} dispatch={dispatch} />
        {selectedNode && <NodeInspector state={state} node={selectedNode} dispatch={dispatch} />}
      </div>
    </div>
  );
}

function ValidityBadge({ valid, validating }: { valid: boolean | null; validating: boolean }): JSX.Element {
  const { label, color } = validating
    ? { label: 'checking…', color: 'var(--color-text-dim)' }
    : valid === true
      ? { label: 'valid', color: 'var(--color-green)' }
      : valid === false
        ? { label: 'invalid', color: 'var(--color-red)' }
        : { label: 'unsaved', color: 'var(--color-text-dim)' };
  return (
    <span
      data-testid="validity-badge"
      style={{
        fontSize: '0.72rem',
        fontWeight: 700,
        color,
        border: `1px solid ${color}`,
        borderRadius: 'var(--radius-block)',
        padding: '0.2rem 0.5rem',
      }}
    >
      {label}
    </span>
  );
}

const metaLabel: React.CSSProperties = {
  fontSize: '0.6rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  color: 'var(--color-text-dim)',
};

const primaryBtn: React.CSSProperties = {
  fontSize: '0.8rem',
  fontWeight: 600,
  padding: '0.4rem 1rem',
  color: 'var(--color-bg)',
  background: 'var(--color-primary)',
  borderRadius: 'var(--radius-block)',
};

const ghostBtn: React.CSSProperties = {
  fontSize: '0.78rem',
  color: 'var(--color-text-muted)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-block)',
  padding: '0.3rem 0.7rem',
};

const alertBox: React.CSSProperties = {
  margin: '0 1rem 0.5rem',
  padding: '0.45rem 0.65rem',
  border: '1px solid var(--color-red)',
  background: 'color-mix(in oklab, var(--color-red) 10%, transparent)',
  borderRadius: 'var(--radius-block)',
  fontSize: '0.8rem',
  display: 'flex',
  gap: 4,
};
