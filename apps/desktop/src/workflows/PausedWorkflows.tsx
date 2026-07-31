import { useState } from 'react';
import { usePausedWorkflows, type PausedWorkflow } from '@moxxy/client-core';
import { Button } from '@moxxy/desktop-ui';

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
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}
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
        gap: 'var(--space-8)',
      }}
    >
      <div className="mono" style={{ fontSize: 'var(--type-label)', color: 'var(--color-text-dim)', textTransform: 'uppercase' }}>
        Workflow <strong>{run.workflow}</strong> is waiting · {run.label}
      </div>
      {run.prompt && (
        <div style={{ fontSize: 'var(--type-row)', whiteSpace: 'pre-wrap' }}>{run.prompt}</div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        style={{ display: 'flex', gap: 'var(--space-8)' }}
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
            fontSize: 'var(--type-row)',
            padding: '0.35rem 0.55rem',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-block)',
            color: 'var(--color-text)',
          }}
        />
        <Button
          variant="cta"
          type="submit"
          data-testid={`paused-send-${run.runId}`}
          disabled={!trimmed || busy}
          style={{
            fontSize: 'var(--type-meta)',
            fontWeight: 600,
            padding: '0 0.8rem',
          }}
        >
          {busy ? 'Sending…' : 'Send'}
        </Button>
      </form>
      {error && (
        <p role="alert" style={{ margin: 0, fontSize: 'var(--type-meta)', color: 'var(--color-pink)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
