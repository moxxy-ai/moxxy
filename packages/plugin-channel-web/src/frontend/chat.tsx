import { useEffect, useRef, useState } from 'react';
import type { TranscriptMessage } from './socket';

/**
 * On-demand chat panel (opened from the floating button) for refining the
 * generated view. Messages flow over the same WS as `prompt` frames → an agent
 * turn → the agent re-runs present_view and the view updates live.
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
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);
  return (
    <div className="chat-panel" role="dialog" aria-label="Chat with the agent">
      <div className="chat-head">
        <span>Chat with the agent</span>
        <button className="chat-x" onClick={onClose} aria-label="Close chat">
          ×
        </button>
      </div>
      <div className="chat-msgs">
        {messages.length === 0 && (
          <div className="chat-hint">Ask the agent to change this view — e.g. “add a price filter” or “sort by departure time”.</div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            {m.text}
          </div>
        ))}
        {status && <div className={status.error ? 'chat-status err' : 'chat-status'}>{status.error ? `⚠ ${status.text}` : status.text}</div>}
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
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask for changes…" autoFocus />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
