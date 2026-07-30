import { useState } from 'react';
import { useWorkflows } from '@moxxy/client-core';
import { Button, Icon, Skeleton } from '@moxxy/desktop-ui';
import { AgentTaskModal } from '../settings/shared/AgentTaskModal';
import { TargetSessionPicker } from '../apps/TargetSessionPicker';
import { WorkflowBuilder } from './WorkflowBuilder';
import { WORKFLOW_PROMPT_TEMPLATE } from './workflow-prompt';
import { InstrumentBar } from '../shell/InstrumentBar';

/** How the defined workflows are triggered, most common first. Derived from the
 *  definitions, which is the only thing this runner reports about them. */
function triggerSummary(list: ReadonlyArray<{ triggers: string }>): string {
  const counts = new Map<string, number>();
  for (const w of list) {
    const kind = (w.triggers.split(/[\s,]+/)[0] || 'manual').toLowerCase();
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  if (counts.size === 0) return '—';
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, n]) => `${n} ${k}`)
    .join(' · ');
}

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
export function WorkflowsPanel(): JSX.Element {
  const wf = useWorkflows();
  const paused = wf.list.filter((w) => !w.enabled).length;
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

  // The pane's actions live in the instrument bar, like every other pane's. A
  // refresh is the weakest action here (the list re-fetches on save and on
  // mount), so it keeps the icon and gives up the word.
  const actions = (
    <>
      <button
        type="button"
        className="btn-box tip"
        data-tip="Refresh"
        data-tip-side="bottom"
        aria-label="Refresh workflows"
        onClick={() => void wf.refresh()}
      >
        <Icon name="rotate" size={14} />
      </button>
      <Button
        variant="chip"
        data-testid="generate-workflow"
        onClick={() => setGenerating(true)}
        style={{ height: 'var(--frame-control)', gap: 'var(--space-6)' }}
      >
        <Icon name="spark" size={14} />
        Generate with AI
      </Button>
      <Button
        variant="primary"
        data-testid="new-workflow"
        onClick={() => setEditing(null)}
        style={{ height: 'var(--frame-control)', padding: '0 var(--space-12)' }}
      >
        New workflow
      </Button>
    </>
  );

  return (
    <>
      <InstrumentBar
        crumbs={[
          'Automations',
          `Workflows · ${wf.list.length} defined${paused > 0 ? `, ${paused} paused` : ''}`,
        ]}
      >
        {actions}
      </InstrumentBar>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: 'var(--space-20) var(--space-32)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-16)',
        }}
      >
      {wf.error && (
        <p
          role="alert"
          style={{
            margin: 0,
            padding: 'var(--space-6) var(--space-8)',
            border: '1px solid var(--color-red-border)',
            background: 'var(--color-red-wash)',
            borderRadius: 'var(--radius-block)',
            fontSize: 'var(--type-row)',
          }}
        >
          {wf.error}
        </p>
      )}
      {wf.loading && wf.list.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
          <Skeleton.Card />
          <Skeleton.Card />
          <Skeleton.Card />
        </div>
      ) : wf.list.length === 0 ? (
        <p style={{ color: 'var(--color-text-dim)' }}>
          No workflows registered on this runner. Use <strong>+ New</strong> to build one.
        </p>
      ) : (
        <>
        {/* The summary row the design puts above the table.
         *
         * Runs / success rate / spend / next fire are NOT here, and that is a data
         * limit rather than an omission: the IPC surface has `workflows.getRun`
         * (one run, by id) and no history API at all, so nothing persists what a
         * run did. Rendering a plausible "94.7%" would be inventing it. These four
         * are computed from the definitions themselves, which is what this runner
         * actually knows. */}
        <div className="kpi">
          <div className="kpi__c">
            <span className="kpi__k">defined</span>
            <span className="kpi__v">{wf.list.length}</span>
          </div>
          <div className="kpi__c">
            <span className="kpi__k">paused</span>
            <span className="kpi__v" data-tone={paused > 0 ? 'caution' : undefined}>
              {paused}
            </span>
          </div>
          <div className="kpi__c">
            <span className="kpi__k">steps</span>
            <span className="kpi__v">
              {wf.list.reduce((n, w) => n + w.steps, 0)}
              <small> across all</small>
            </span>
          </div>
          <div className="kpi__c">
            <span className="kpi__k">triggers</span>
            <span className="kpi__v kpi__v--text">{triggerSummary(wf.list)}</span>
          </div>
        </div>

        <div className="data-section">
          <span className="data-section__t">defined</span>
        </div>
        <div className="data-table" role="table" aria-label="Workflows">
          <div className="data-row data-row--head" role="row">
            <span />
            <span role="columnheader">workflow</span>
            <span role="columnheader">trigger</span>
            <span role="columnheader">runs in</span>
            <span role="columnheader">state</span>
            <span />
          </div>
          {wf.list.map((w) => (
            <div
              key={w.name}
              className="data-row"
              role="row"
              data-testid={`workflow-row-${w.name}`}
            >
              {/* State reads as a colour AND a word (the toggle below), so a
                  paused workflow is visible at a glance down the LED column. */}
              <span className="led" data-state={w.enabled ? 'done' : undefined} aria-hidden />
              <span className="data-row__name" role="cell">
                {w.name}
                <small>
                  {w.steps} nodes · {w.scope}
                </small>
                {w.description && <em>{w.description}</em>}
              </span>
              <span className="data-row__meta" role="cell">
                {w.triggers}
              </span>
              <span role="cell">
                <TargetSessionPicker
                  value={w.targetSessionId ?? null}
                  valueName={w.targetSessionName ?? null}
                  onChange={(sid) => void wf.setTargetSession(w.name, sid)}
                />
              </span>
              <span role="cell">
                <button
                  type="button"
                  className="tag"
                  data-testid={`toggle-workflow-${w.name}`}
                  aria-pressed={w.enabled}
                  aria-label={`${w.enabled ? 'Disable' : 'Enable'} ${w.name}`}
                  onClick={() => void wf.setEnabled(w.name, !w.enabled)}
                  style={
                    w.enabled
                      ? { color: 'var(--color-green)', borderColor: 'var(--color-green)' }
                      : undefined
                  }
                >
                  {w.enabled ? 'on' : 'paused'}
                </button>
              </span>
              <span className="data-row__acts" role="cell">
                <button
                  type="button"
                  className="btn-box tip"
                  data-tip="Edit"
                  data-tip-side="left"
                  data-testid={`edit-workflow-${w.name}`}
                  aria-label={`Edit ${w.name}`}
                  onClick={() => setEditing(w.name)}
                >
                  <Icon name="pencil" size={14} />
                </button>
                <button
                  type="button"
                  className="btn-box tip"
                  data-tip="Run now"
                  data-tip-side="left"
                  aria-label={`Run ${w.name}`}
                  onClick={() => void wf.run(w.name)}
                >
                  <Icon name="send" size={14} />
                </button>
              </span>
            </div>
          ))}
        </div>
        </>
      )}
      {wf.lastRun && (
        <section
          style={{
            padding: '0.75rem 0.85rem',
            background: 'var(--color-card-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-block)',
          }}
        >
          <header
            className="mono"
            style={{
              fontSize: 'var(--type-label)',
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
              borderRadius: 'var(--radius-chip)',
              fontSize: 'var(--type-label)',
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
    fontSize: 'var(--type-meta)',
    padding: '0.25rem 0.7rem',
    color: 'var(--color-bg)',
    background: bg,
    borderRadius: 'var(--radius-block)',
    fontWeight: 600,
  };
}
