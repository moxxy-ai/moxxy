import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { TranscriptMessage } from './socket';
import { FileDiffView } from './render-diff';

/** Whether the user has asked the OS to reduce motion (SSR-safe). */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Focusable descendants of a container, in DOM order, for the focus trap. */
function focusableWithin(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  const sel = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(root.querySelectorAll<HTMLElement>(sel)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/**
 * On-demand chat panel (opened from the floating button) for refining the
 * generated view. Messages flow over the same WS as `prompt` frames → an agent
 * turn → the agent re-runs present_view and the view updates live.
 *
 * Implemented as an accessible modal dialog: focus moves into the input on open
 * and is restored to the opener (the FAB) on close, Tab is trapped inside the
 * panel, Escape dismisses it, and the message/status region is an aria-live
 * region so screen-reader users hear the agent's replies.
 */
export function ChatPanel(props: {
  messages: ReadonlyArray<TranscriptMessage>;
  status: { text: string; error: boolean } | null;
  onSend: (text: string) => void;
  onClose: () => void;
}): JSX.Element {
  const { messages, status, onSend, onClose } = props;
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [messages, status]);

  // Focus the input on open; restore focus to the element that had it (the FAB)
  // when the dialog unmounts, so keyboard users aren't dumped at the page top.
  useEffect(() => {
    const opener = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    inputRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      // Trap Tab within the panel so focus never escapes to the obscured view.
      const focusables = focusableWithin(panelRef.current);
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  return (
    <div
      className="chat-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Chat with the agent"
      ref={panelRef}
      onKeyDown={onKeyDown}
    >
      <div className="chat-head">
        <span>Chat with the agent</span>
        <button className="chat-x" onClick={onClose} aria-label="Close chat">
          ×
        </button>
      </div>
      <div className="chat-msgs" role="log" aria-live="polite" aria-relevant="additions text">
        {messages.length === 0 && (
          <div className="chat-hint">Ask the agent to change this view — e.g. “add a price filter” or “sort by departure time”.</div>
        )}
        {messages.map((m, i) =>
          m.role === 'diff' ? (
            <FileDiffView key={i} display={m.display} />
          ) : (
            <div key={i} className={`chat-msg ${m.role}`}>
              {m.text}
            </div>
          ),
        )}
        {status && (
          <div className={status.error ? 'chat-status err' : 'chat-status'} role="status">
            {status.error ? `⚠ ${status.text}` : status.text}
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t) return;
          onSend(t);
          setText('');
        }}
      >
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask for changes…"
          aria-label="Ask the agent for changes"
        />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
