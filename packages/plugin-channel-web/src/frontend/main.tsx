import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useViewSocket } from './socket';
import { renderNode } from './render';

function PromptBox(props: { onSend: (text: string) => void }): JSX.Element {
  const [text, setText] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const t = text.trim();
        if (!t) return;
        props.onSend(t);
        setText('');
      }}
    >
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask the agent…" autoFocus />
      <button type="submit">Send</button>
    </form>
  );
}

function App(): JSX.Element {
  const { connected, view, canGoBack, messages, status, dispatch, navigate, goBack, sendPrompt } = useViewSocket();
  return (
    <div className="app">
      <header>
        <span>
          {canGoBack && (
            <button className="back" onClick={goBack} aria-label="Back">
              ‹ Back
            </button>
          )}
          moxxy
        </span>
        <span className={connected ? 'status ok' : 'status'}>{connected ? '● live' : '○ connecting…'}</span>
      </header>
      <main>
        {view ? (
          <div className="view">{renderNode(view.doc.root, { dispatch, navigate })}</div>
        ) : (
          <div className="empty">No view yet — ask the agent to build you something.</div>
        )}
        {messages.length > 0 && (
          <div className="transcript">
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                {m.text}
              </div>
            ))}
          </div>
        )}
        {status && <div className={status.error ? 'turn-status err' : 'turn-status'}>{status.error ? `⚠ ${status.text}` : status.text}</div>}
      </main>
      <footer>
        <PromptBox onSend={sendPrompt} />
      </footer>
    </div>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
