import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '@moxxy/desktop-ui';

interface GoalModalProps {
  /** Prefill the objective with whatever the user already typed in the
   *  composer, so the chip works as a one-click "promote draft to goal". */
  readonly defaultObjective?: string;
  readonly onCancel: () => void;
  /** Approve: hand the objective back so the composer can switch to goal
   *  mode, turn auto-approve on, and submit it. */
  readonly onStart: (objective: string) => void;
}

/**
 * Goal composer. Opened from the composer's "+" menu — the user states
 * an objective, and approving it switches the session to goal mode,
 * enables auto-approve, and sends the objective so the agent works
 * autonomously until it's delivered. Closes on Escape / backdrop click.
 */
export function GoalModal({
  defaultObjective = '',
  onCancel,
  onStart,
}: GoalModalProps): JSX.Element {
  const [objective, setObjective] = useState(defaultObjective);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    taRef.current?.focus();
    taRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const canStart = objective.trim().length > 0;
  const start = (): void => {
    if (canStart) onStart(objective.trim());
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter submits; Shift+Enter inserts a newline (mirrors the composer).
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      start();
    }
  };

  return (
    <div
      onMouseDown={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(15, 23, 42, 0.35)',
      }}
    >
      <div
        role="dialog"
        aria-label="Start a goal"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 460,
          maxWidth: 'calc(100vw - 48px)',
          background: 'var(--color-card-bg)',
          border: '1px solid var(--color-card-border)',
          borderRadius: 16,
          boxShadow: '0 24px 60px -28px rgba(15, 23, 42, 0.5)',
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span
            aria-hidden
            style={{
              width: 28,
              height: 28,
              flexShrink: 0,
              borderRadius: 8,
              background: 'var(--color-primary-soft)',
              color: 'var(--color-primary-strong)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="agent" size={16} />
          </span>
          <div>
            <h3
              style={{
                margin: 0,
                fontSize: 14.5,
                fontWeight: 700,
                color: 'var(--color-text)',
              }}
            >
              Start a goal
            </h3>
            <p
              style={{
                margin: 0,
                fontSize: 11.5,
                color: 'var(--color-text-dim)',
              }}
            >
              The agent works autonomously (auto-approve on) until it's done.
            </p>
          </div>
        </div>

        <textarea
          ref={taRef}
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Describe the objective to accomplish…"
          rows={4}
          style={{
            width: '100%',
            resize: 'vertical',
            padding: '10px 12px',
            fontSize: 13.5,
            lineHeight: 1.5,
            color: 'var(--color-text)',
            background: '#fff',
            border: '1px solid var(--color-card-border)',
            borderRadius: 10,
            outline: 'none',
            fontFamily: 'inherit',
          }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '8px 15px',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--color-text-muted)',
              background: '#fff',
              border: '1px solid var(--color-card-border)',
              borderRadius: 10,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-cta"
            onClick={start}
            disabled={!canStart}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '8px 15px',
              fontSize: 13,
              fontWeight: 600,
              color: '#fff',
              background: 'var(--color-primary-strong)',
              border: '1px solid transparent',
              borderRadius: 10,
              opacity: canStart ? 1 : 0.5,
            }}
          >
            <Icon name="agent" size={15} />
            Start goal
          </button>
        </div>
      </div>
    </div>
  );
}
