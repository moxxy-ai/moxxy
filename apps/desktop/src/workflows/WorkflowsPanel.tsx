import { useState } from 'react';
import { useWorkflows } from '@moxxy/client-core';
import { Skeleton } from '@moxxy/desktop-ui';
import { WorkflowBuilder } from './WorkflowBuilder';

/**
 * Workflows surface — two modes:
 *   - list: the existing registry view with enable/disable + run-now + last-run
 *     status, plus "New" and per-row "Edit" that open the visual builder.
 *   - builder: the drag canvas (palette + nodes + edges + inspector + save).
 *
 * State/logic for the builder live in the shared `@moxxy/workflows-builder`
 * model via `useWorkflowBuilder`; this panel only owns the mode toggle and
 * wires the list's `refresh` so a save re-lists.
 */
export function WorkflowsPanel(): JSX.Element {
  const wf = useWorkflows();
  // `editing === undefined` → list; `null` → new workflow; string → edit by name.
  const [editing, setEditing] = useState<string | null | undefined>(undefined);

  if (editing !== undefined) {
    return (
      <WorkflowBuilder
        name={editing}
        onClose={() => setEditing(undefined)}
        onSaved={() => {
          void wf.refresh();
        }}
      />
    );
  }

  return (
    <main
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '1.5rem 2rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Workflows</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="button"
            data-testid="new-workflow"
            onClick={() => setEditing(null)}
            style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              color: 'var(--color-bg)',
              background: 'var(--color-primary)',
              borderRadius: 'var(--radius-block)',
              padding: '0.25rem 0.7rem',
            }}
          >
            + New
          </button>
          <button
            type="button"
            onClick={() => void wf.refresh()}
            style={{
              fontSize: '0.75rem',
              color: 'var(--color-text-dim)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-block)',
              padding: '0.2rem 0.55rem',
            }}
          >
            Refresh
          </button>
        </div>
      </header>
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
                onClick={() => setEditing(w.name)}
                style={pill('var(--color-purple)')}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => void wf.setEnabled(w.name, !w.enabled)}
                style={pill(w.enabled ? 'var(--color-green)' : 'var(--color-text-dim)')}
              >
                {w.enabled ? 'on' : 'off'}
              </button>
              <button
                type="button"
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
    </main>
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
