/**
 * Shared "ask moxxy to do it" modal — takes a free-text description, wraps it
 * with the caller's prompt template, and runs it as a hidden background agent
 * turn (useAgentTask), streaming the assistant's reply into a preview.
 *
 * The agent's tools may gate on permission asks while the user is here (away
 * from the chat's AskSheet), so the modal embeds its own AskSheet and claims
 * the global ask surface while mounted — otherwise the runner would block on
 * an invisible prompt forever.
 */

import { useEffect, useRef, useState } from 'react';
import { useActiveAsk, useActiveWorkspaceId } from '@moxxy/client-core';
import { Button, Icon, Modal, TextArea } from '@moxxy/desktop-ui';
import { MarkdownBody } from '@/chat/MarkdownBody';
import { AskSheet } from '@/chat/AskSheet';
import { useClaimAskSurface } from '@/lib/askSurface';
import { useAgentTask, type AgentTaskPhase } from './useAgentTask';

export function AgentTaskModal({
  title,
  label,
  placeholder,
  hint,
  buildPrompt,
  onComplete,
  doneLabel,
  onClose,
  onUseOutput,
}: {
  readonly title: string;
  readonly label: string;
  readonly placeholder: string;
  readonly hint: string;
  readonly buildPrompt: (description: string) => string;
  /** Awaited (e.g. section refresh) before the CTA flips to `doneLabel`. */
  readonly onComplete?: () => Promise<void>;
  readonly doneLabel: string;
  readonly onClose: () => void;
  /** When set, the done CTA hands the output off instead of closing. */
  readonly onUseOutput?: (output: string) => void;
}): JSX.Element {
  const workspaceId = useActiveWorkspaceId();
  const [description, setDescription] = useState('');
  const task = useAgentTask(workspaceId);

  // Permission asks raised by the agent's tools must surface HERE — the
  // chat's AskSheet isn't visible from settings. Claiming the surface also
  // suppresses the App-level fallback so the ask never double-renders.
  useClaimAskSurface();
  const ask = useActiveAsk(workspaceId);

  // Hold the "done" CTA until onComplete (the section refresh) has settled,
  // so the list behind the modal already shows the agent's work. A refresh
  // failure isn't a generation failure — the section owns its own error
  // chrome — so we finalize either way.
  const [finalized, setFinalized] = useState(false);
  const completeRan = useRef(false);
  useEffect(() => {
    if (task.phase !== 'done' || completeRan.current) return;
    completeRan.current = true;
    let cancelled = false;
    void (onComplete?.() ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => {
        if (!cancelled) setFinalized(true);
      });
    return () => {
      cancelled = true;
    };
  }, [task.phase, onComplete]);

  // A turn that "succeeds" without producing any output is a failure from the
  // user's point of view — never present it as silent success.
  const emptyDone = task.phase === 'done' && finalized && task.output.trim().length === 0;
  const phase: AgentTaskPhase = emptyDone
    ? 'error'
    : task.phase === 'done' && !finalized
      ? 'streaming'
      : task.phase;
  const error = emptyDone ? 'Generation produced no output.' : task.error;

  const onStart = async (): Promise<void> => {
    if (!workspaceId || !description.trim()) return;
    completeRan.current = false;
    setFinalized(false);
    await task.start(buildPrompt(description.trim()));
  };

  return (
    <Modal title={title} onClose={onClose} width={760}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-muted)' }}>
            {label}
          </span>
          <TextArea
            tone="soft"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={placeholder}
            disabled={phase === 'streaming'}
            style={{ minHeight: 110, padding: '12px 14px', fontSize: 13, lineHeight: 1.6 }}
          />
        </label>
        <span style={{ fontSize: 11.5, color: 'var(--color-text-dim)' }}>
          {workspaceId ? hint : 'No active workspace — open one before generating.'}
        </span>
        {(phase === 'streaming' || phase === 'done' || phase === 'error') && (
          <section
            style={{
              border: '1px solid var(--color-card-border)',
              borderRadius: 12,
              overflow: 'hidden',
              background: '#fff',
            }}
          >
            <header
              style={{
                padding: '8px 12px',
                background: '#f4f5fb',
                borderBottom: '1px solid var(--color-card-border)',
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--color-text-dim)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              Preview {phase === 'streaming' && '· streaming'}
            </header>
            <div
              style={{
                maxHeight: 360,
                overflowY: 'auto',
                padding: 16,
              }}
            >
              {task.output ? (
                <MarkdownBody text={task.output} streaming={phase === 'streaming'} />
              ) : (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-dim)' }}>
                  Waiting for the first chunk…
                </p>
              )}
            </div>
          </section>
        )}
        {ask && <AskSheet ask={ask} />}
        {error && (
          <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--color-red)' }}>
            {error}
          </p>
        )}
        <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {(() => {
            // One primary action that morphs by phase: Generate → Generating…
            // → doneLabel (shown in the same spot once output exists).
            const ready = phase === 'done' && task.output.trim().length > 0;
            const canGenerate = !!workspaceId && description.trim().length > 0;
            const disabled = phase === 'streaming' || (!ready && !canGenerate);
            return (
              <Button
                variant="cta"
                onClick={
                  ready
                    ? () => (onUseOutput ? onUseOutput(task.output) : onClose())
                    : () => void onStart()
                }
                disabled={disabled}
                style={{ padding: '8px 16px', opacity: disabled ? 0.5 : 1 }}
              >
                <Icon name={ready ? 'check' : 'spark'} size={14} />
                {phase === 'streaming' ? 'Generating…' : ready ? doneLabel : 'Generate'}
              </Button>
            );
          })()}
        </footer>
      </div>
    </Modal>
  );
}
