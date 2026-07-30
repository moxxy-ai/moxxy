import { useEffect } from 'react';
import { useActionCatalog, useWorkflowBuilder } from '@moxxy/client-core';
import { Button, Icon, TextInput } from '@moxxy/desktop-ui';
import { WORKFLOW_ERROR_KEY } from '@moxxy/workflows-builder';
import { WorkflowCanvas } from './WorkflowCanvas';
import { NodeInspector } from './NodeInspector';
import { Palette } from './Palette';
import { TargetSessionPicker } from '../apps/TargetSessionPicker';

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
  const catalog = useActionCatalog();
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
      {/* Bottom-aligned: the labelled fields carry a label row the bare controls
          don't, so centring floated Back/valid/Save above the input line. */}
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 'var(--space-8)',
          padding: 'var(--space-8) var(--space-16)',
          borderBottom: '1px solid var(--color-card-border)',
        }}
      >
        <Button variant="secondary" data-testid="builder-back" onClick={onClose} size="lg">
          <Icon name="chevron-right" size={12} style={{ transform: 'rotate(180deg)' }} />
          Back
        </Button>
        <label className="form__field" style={{ minWidth: 200 }}>
          <span className="form__label">name</span>
          <TextInput
            tone="soft"
            mono
            value={state.meta.name}
            data-testid="builder-name"
            onChange={(e) => dispatch({ type: 'update-meta', patch: { name: e.target.value } })}
          />
        </label>
        <label className="form__field" style={{ flex: 1, minWidth: 0 }}>
          <span className="form__label">description</span>
          <TextInput
            tone="soft"
            value={state.meta.description}
            data-testid="builder-description"
            onChange={(e) => dispatch({ type: 'update-meta', patch: { description: e.target.value } })}
          />
        </label>
        <div className="form__field">
          <span className="form__label">runs in</span>
          <TargetSessionPicker
            label=""
            value={state.meta.targetSessionId ?? null}
            valueName={null}
            onChange={(sid) =>
              dispatch({ type: 'update-meta', patch: { targetSessionId: sid ?? undefined } })
            }
          />
        </div>
        <ValidityBadge valid={builder.valid} validating={builder.validating} />
        <Button
          variant="cta"
          size="lg"
          data-testid="builder-save"
          disabled={builder.saving || builder.valid === false}
          onClick={() => void onSave()}
        >
          {builder.saving ? 'Saving…' : 'Save'}
        </Button>
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
        {selectedNode && (
          <NodeInspector state={state} node={selectedNode} dispatch={dispatch} catalog={catalog} />
        )}
      </div>
    </div>
  );
}

/** The draft's validation state, as the same outlined readout every other state
 *  in the app uses. It is a `.tag`, not a button: you cannot press it. */
function ValidityBadge({ valid, validating }: { valid: boolean | null; validating: boolean }): JSX.Element {
  const { label, color } = validating
    ? { label: 'checking', color: 'var(--color-text-dim)' }
    : valid === true
      ? { label: 'valid', color: 'var(--color-green)' }
      : valid === false
        ? { label: 'invalid', color: 'var(--color-red-text)' }
        : { label: 'unsaved', color: 'var(--color-text-dim)' };
  return (
    <span
      className="tag"
      data-testid="validity-badge"
      style={{ height: 'var(--frame-row)', color, borderColor: color }}
    >
      {label}
    </span>
  );
}

const alertBox: React.CSSProperties = {
  margin: '0 1rem 0.5rem',
  padding: 'var(--space-6) var(--space-8)',
  border: '1px solid var(--color-red)',
  background: 'color-mix(in oklab, var(--color-red) 10%, transparent)',
  borderRadius: 'var(--radius-block)',
  fontSize: 'var(--type-meta)',
  display: 'flex',
  gap: 4,
};
