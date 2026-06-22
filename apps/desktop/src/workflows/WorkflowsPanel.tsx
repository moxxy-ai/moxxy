import { useState } from 'react';
import { useWorkflows } from '@moxxy/client-core';
import { Button, Icon, Skeleton } from '@moxxy/desktop-ui';
import { AgentTaskModal } from '../settings/shared/AgentTaskModal';
import { WorkflowBuilder } from './WorkflowBuilder';
import { WORKFLOW_PROMPT_TEMPLATE } from './workflow-prompt';
import { ViewHeader, ViewSwitcher, type View } from '../shell/ViewHeader';

/**
 * Workflows surface — two modes:
 *   - list: the existing registry view with enable/disable + run-now + last-run
 *     status, plus "New" and per-row "Edit" that open the visual builder, and
 *     "Generate with AI" which hands the description to a hidden agent turn
 *     (shared AgentTaskModal) that creates the workflow via the workflow tools.
 *   - builder: the drag canvas (palette + nodes + edges + inspector + save).
 *
 * State/logic for the builder live in the shared `@moxxy/workflows-builder`
 * model via `useWorkflowBuilder`; this panel only owns the mode toggle and
 * wires the list's `refresh` so a save (or a generated workflow) re-lists.
 */
export function WorkflowsPanel({
  // Optional so the panel can render standalone (tests); the app shell
  // always wires it so the header switcher navigates.
  onView = () => undefined,
  disabledViews,
  disabledViewReason,
}: {
  readonly onView?: (v: View) => void;
  readonly disabledViews?: ReadonlyArray<View>;
  readonly disabledViewReason?: string;
}): JSX.Element {
  const wf = useWorkflows();
  // `editing === undefined` → list; `null` → new workflow; string → edit by name.
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const [generating, setGenerating] = useState(false);

  if (editing !== undefined) {
    return (
      <WorkflowBuilder
        // Re-key per target so switching workflows (Edit A → Back → Edit B, or
        // re-entering quickly) mounts a FRESH builder instance: its
        // `useWorkflowBuilder` state + the in-flight `load` are discarded, so a
        // slower earlier load can't resolve last and hydrate the wrong YAML.
        key={editing ?? '__new__'}
        name={editing}
        onClose={() => setEditing(undefined)}
        onSaved={() => {
          void wf.refresh();
        }}
      />
    );
  }

  return (
    <>
      <ViewHeader>
        <ViewSwitcher
          view="workflows"
          onView={onView}
          disabledViews={disabledViews}
          disabledReason={disabledViewReason}
        />
        <span style={{ flex: 1 }} />
        <Button variant="chip" onClick={() => void wf.refresh()} style={{ borderRadius: 9 }}>
          <Icon name="rotate" size={14} />
          Refresh
        </Button>
        <Button
          variant="chip"
          data-testid="generate-workflow"
          onClick={() => setGenerating(true)}
          style={{ borderRadius: 9, gap: 7 }}
        >
          <Icon name="spark" size={14} />
          Generate with AI
        </Button>
        <Button
          variant="primary"
          data-testid="new-workflow"
          onClick={() => setEditing(null)}
          style={{ borderRadius: 9, padding: '6px 14px', fontSize: 13 }}
        >
          + New
        </Button>
      </ViewHeader>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '1.5rem 2rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
      {wf.error && (
        <p
          role="alert"
          style={{
            margin: 0,
            padding: '0.45rem 0.65rem',
            border: '1px solid var(--color-pink)',
            background: 'color-mix(in oklab, var(--color-pink) 12%, transparent)',
            borderRadius: 'var(--radius-block)',
            fontSize: '0.85rem',
          }}
        >
          {wf.error}
        </p>
      )}
      {wf.loading && wf.list.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <Skeleton.Card />
          <Skeleton.Card />
          <Skeleton.Card />
        </div>
      ) : wf.list.length === 0 ? (
        <p style={{ color: 'var(--color-text-dim)' }}>
          No workflows registered on this runner. Use <strong>+ New</strong> to build one.
        </p>
      ) : (
        <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {wf.list.map((w) => (
            <li
              key={w.name}
              data-testid={`workflow-row-${w.name}`}
              style={{
                padding: '0.65rem 0.85rem',
                background: 'var(--color-bg-card)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-block)',
                display: 'grid',
                gridTemplateColumns: '1fr auto auto auto',
                gap: '0.5rem',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{w.name}</div>
                <div
                  className="mono"
                  style={{
                    fontSize: '0.7rem',
                    color: 'var(--color-text-dim)',
                  }}
                >
                  {w.steps} steps · {w.scope} · {w.triggers}
                </div>
                {w.description && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: 4 }}>
                    {w.description}
                  </div>
                )}
              </div>
              <button
                type="button"
                data-testid={`edit-workflow-${w.name}`}
                aria-label={`Edit ${w.name}`}
                onClick={() => setEditing(w.name)}
                style={pill('var(--color-purple)')}
              >
                Edit
              </button>
              <button
                type="button"
                aria-pressed={w.enabled}
                aria-label={`${w.enabled ? 'Disable' : 'Enable'} ${w.name}`}
                onClick={() => void wf.setEnabled(w.name, !w.enabled)}
                style={pill(w.enabled ? 'var(--color-green)' : 'var(--color-text-dim)')}
              >
                {w.enabled ? 'on' : 'off'}
              </button>
              <button
                type="button"
                aria-label={`Run ${w.name}`}
                onClick={() => void wf.run(w.name)}
                style={pill('var(--color-primary)')}
              >
                Run
              </button>
            </li>
          ))}
        </ul>
      )}
      {wf.lastRun && (
        <section
          style={{
            padding: '0.75rem 0.85rem',
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-block)',
          }}
        >
          <header
            className="mono"
            style={{
              fontSize: '0.7rem',
              color: 'var(--color-text-dim)',
              textTransform: 'uppercase',
            }}
          >
            last run · {wf.lastRun.name}
          </header>
          <pre
            className="mono"
            style={{
              margin: '0.4rem 0 0',
              padding: '0.45rem 0.6rem',
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 4,
              fontSize: '0.7rem',
              maxHeight: 240,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
            }}
          >
            {wf.lastRun.result.output ||
              wf.lastRun.result.error ||
              JSON.stringify(wf.lastRun.result.steps, null, 2)}
          </pre>
        </section>
      )}
      </div>
      {generating && (
        <AgentTaskModal
          title="Generate workflow with AI"
          label="Describe the workflow"
          placeholder="e.g. Every weekday at 9am, summarise my inbox with the summarize-inbox skill and post the digest to Slack."
          hint="Moxxy builds it in the background — it drafts the steps, validates the DAG, and registers the workflow on this runner."
          buildPrompt={WORKFLOW_PROMPT_TEMPLATE}
          onComplete={wf.refresh}
          doneLabel="Done"
          onClose={() => setGenerating(false)}
        />
      )}
    </>
  );
}

function pill(bg: string): React.CSSProperties {
  return {
    fontSize: '0.75rem',
    padding: '0.25rem 0.7rem',
    color: 'var(--color-bg)',
    background: bg,
    borderRadius: 'var(--radius-block)',
    fontWeight: 600,
  };
}
