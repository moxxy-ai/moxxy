import { useState } from 'react';
import { usePausedWorkflows, type PausedWorkflow } from '@moxxy/client-core';

/**
 * Human-in-the-loop surface: every workflow run currently parked on an
 * `awaitInput` step renders a card — "Workflow <name> is waiting: <prompt>" —
 * with a reply box. Submitting calls `workflows.resume(runId, reply)` through
 * the client-core hook (which goes over the desktop IPC → runner). The card
 * disappears the moment the run resumes (driven by the `workflow_resumed` /
 * `workflow_completed` events the hook listens to).
 */
export function PausedWorkflows(): JSX.Element | null {
  const { paused, errors, resuming, resume } = usePausedWorkflows();
  if (paused.length === 0) return null;
  return (
    <section
      data-testid="paused-workflows"
      aria-label="Workflows awaiting your reply"
      style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
    >
      {paused.map((run) => (
        <PausedCard
          key={run.runId}
          run={run}
          busy={resuming.includes(run.runId)}
          error={errors[run.runId] ?? null}
          onReply={(reply) => void resume(run.runId, reply)}
        />
      ))}
    </section>
  );
}

function PausedCard(props: {
  run: PausedWorkflow;
  busy: boolean;
  error: string | null;
  onReply: (reply: string) => void;
}): JSX.Element {
  const { run, busy, error, onReply } = props;
  const [reply, setReply] = useState('');
  const trimmed = reply.trim();
  const submit = (): void => {
    if (!trimmed || busy) return;
    onReply(trimmed);
  };
  return (
    <div
      data-testid={`paused-workflow-${run.runId}`}
      style={{
        padding: '0.7rem 0.85rem',
        background: 'color-mix(in oklab, var(--color-amber) 12%, var(--color-bg-card))',
        border: '1px solid var(--color-amber)',
        borderRadius: 'var(--radius-block)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
      }}
    >
      <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--color-text-dim)', textTransform: 'uppercase' }}>
        Workflow <strong>{run.workflow}</strong> is waiting · {run.label}
      </div>
      {run.prompt && (
        <div style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>{run.prompt}</div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        style={{ display: 'flex', gap: '0.5rem' }}
      >
        <input
          type="text"
          data-testid={`paused-reply-${run.runId}`}
          aria-label={`Reply to ${run.workflow}`}
          placeholder="Type your reply…"
          value={reply}
          disabled={busy}
          onChange={(e) => setReply(e.target.value)}
          style={{
            flex: 1,
            fontSize: '0.85rem',
            padding: '0.35rem 0.55rem',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-block)',
            color: 'var(--color-text)',
          }}
        />
        <button
          type="submit"
          data-testid={`paused-send-${run.runId}`}
          disabled={!trimmed || busy}
          style={{
            fontSize: '0.75rem',
            fontWeight: 600,
            color: 'var(--color-bg)',
            background: 'var(--color-primary)',
            borderRadius: 'var(--radius-block)',
            padding: '0.3rem 0.8rem',
            opacity: !trimmed || busy ? 0.5 : 1,
          }}
        >
          {busy ? 'Sending…' : 'Send'}
        </button>
      </form>
      {error && (
        <p role="alert" style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-pink)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
