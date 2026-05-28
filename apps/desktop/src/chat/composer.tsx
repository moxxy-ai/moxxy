import { useCallback, useRef, useState, type KeyboardEvent } from 'react';

interface ComposerProps {
  readonly ready: boolean;
  readonly activeTurnId: string | null;
  readonly onSend: (prompt: string) => void;
  readonly onAbort: () => void;
}

/**
 * Multi-line composer with ⌘↵ submit. While a turn is in flight the
 * Send button swaps to Abort.
 */
export function Composer({
  ready,
  activeTurnId,
  onSend,
  onAbort,
}: ComposerProps): JSX.Element {
  const [draft, setDraft] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const disabled = !ready || activeTurnId !== null;
  const canSubmit = !disabled && draft.trim().length > 0;

  const submit = useCallback(() => {
    if (!canSubmit) return;
    onSend(draft);
    setDraft('');
  }, [canSubmit, draft, onSend]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    // ⌘↵ on macOS, Ctrl+Enter elsewhere. Shift+Enter falls through to
    // newline (default behaviour).
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
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        padding: '0.85rem 2rem 1rem',
        background: 'var(--color-bg)',
        borderTop: '1px solid var(--color-border)',
        display: 'flex',
        gap: '0.5rem',
        alignItems: 'flex-end',
      }}
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.25rem',
        }}
      >
        <textarea
          ref={taRef}
          data-testid="composer-input"
          aria-label="prompt"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={ready ? 'Ask anything…' : 'Waiting for runner…'}
          disabled={disabled}
          rows={Math.min(8, Math.max(1, draft.split('\n').length))}
          style={{
            width: '100%',
            resize: 'none',
            padding: '0.55rem 0.8rem',
            fontSize: '0.95rem',
            lineHeight: 1.5,
            color: 'var(--color-text)',
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-block)',
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
        <div
          className="mono"
          data-testid="composer-hint"
          style={{
            fontSize: '0.65rem',
            color: 'var(--color-text-dim)',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>{draft.length} chars</span>
          <span>⌘↵ to send · Esc to clear · Shift+↵ for newline</span>
        </div>
      </div>
      {activeTurnId === null ? (
        <button
          type="submit"
          data-testid="composer-send"
          disabled={!canSubmit}
          style={{
            padding: '0.5rem 0.9rem',
            background: 'var(--color-primary)',
            color: 'var(--color-bg)',
            borderRadius: 'var(--radius-block)',
            fontWeight: 600,
            opacity: canSubmit ? 1 : 0.4,
          }}
        >
          Send
        </button>
      ) : (
        <button
          type="button"
          data-testid="composer-abort"
          onClick={onAbort}
          style={{
            padding: '0.5rem 0.9rem',
            background: 'var(--color-pink)',
            color: 'var(--color-bg)',
            borderRadius: 'var(--radius-block)',
            fontWeight: 600,
          }}
        >
          Abort
        </button>
      )}
    </form>
  );
}
