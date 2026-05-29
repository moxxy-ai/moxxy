import { useCallback, useRef, useState, type KeyboardEvent } from 'react';

interface ComposerProps {
  readonly ready: boolean;
  readonly sending: boolean;
  readonly activeTurnId: string | null;
  readonly onSend: (prompt: string) => void;
  readonly onAbort: () => void;
}

/**
 * Composer rendered as a rounded white card flush against the chat
 * pane bottom. Mirrors the reference shot: leading + button, attach +
 * context chips, trailing send button (blue when armed).
 *
 *   ⌘↵ / Ctrl+↵   submit
 *   Shift+↵       newline
 *   Esc           clear draft
 */
export function Composer({
  ready,
  sending,
  activeTurnId,
  onSend,
  onAbort,
}: ComposerProps): JSX.Element {
  const [draft, setDraft] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const inFlight = activeTurnId !== null || sending;
  const canSubmit = ready && !inFlight && draft.trim().length > 0;

  const submit = useCallback(() => {
    if (!canSubmit) return;
    onSend(draft);
    setDraft('');
  }, [canSubmit, draft, onSend]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setDraft('');
    }
  };

  return (
    <form
      data-testid="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      style={{
        margin: '12px 18px 4px',
        padding: '12px 14px',
        background: 'var(--color-card-bg)',
        border: '1px solid var(--color-card-border)',
        borderRadius: 16,
        boxShadow: 'var(--color-card-shadow)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <textarea
        ref={taRef}
        data-testid="composer-input"
        aria-label="prompt"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={ready ? 'Send a message to the agent…' : 'Waiting for runner…'}
        disabled={!ready || inFlight}
        rows={Math.min(8, Math.max(1, draft.split('\n').length))}
        style={{
          width: '100%',
          resize: 'none',
          padding: '4px 6px 6px',
          fontSize: 14.5,
          lineHeight: 1.55,
          color: 'var(--color-text)',
          background: 'transparent',
          border: 'none',
          fontFamily: 'inherit',
          outline: 'none',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <ToolChip label="Add">+</ToolChip>
        <ToolChip label="Attach file">📎 Attach</ToolChip>
        <ToolChip label="Add context">＋ Context</ToolChip>
        <span style={{ flex: 1 }} />
        {inFlight ? (
          <button
            type="button"
            data-testid="composer-abort"
            onClick={onAbort}
            style={sendBtn('var(--color-red)', true)}
            aria-label="Abort"
          >
            ◼
          </button>
        ) : (
          <button
            type="submit"
            data-testid="composer-send"
            disabled={!canSubmit}
            style={sendBtn('var(--color-send)', canSubmit)}
            aria-label="Send"
          >
            ➤
          </button>
        )}
      </div>
      <p
        style={{
          margin: 0,
          textAlign: 'center',
          fontSize: 11,
          color: 'var(--color-text-dim)',
        }}
      >
        Agent may make mistakes. Verify important information. · ⌘↵ to send
      </p>
    </form>
  );
}

function ToolChip({
  children,
  label,
  onClick,
}: {
  readonly children: React.ReactNode;
  readonly label: string;
  readonly onClick?: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{
        padding: '6px 10px',
        fontSize: 12.5,
        color: 'var(--color-text-muted)',
        border: '1px solid var(--color-card-border)',
        borderRadius: 10,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: '#fff',
      }}
    >
      {children}
    </button>
  );
}

function sendBtn(bg: string, enabled: boolean): React.CSSProperties {
  return {
    width: 38,
    height: 38,
    borderRadius: 12,
    background: bg,
    color: '#fff',
    fontSize: 14,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: enabled ? 1 : 0.45,
    boxShadow: enabled ? '0 8px 20px -10px rgba(59, 130, 246, 0.5)' : 'none',
  };
}
