import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useViewSocket } from './socket';
import { renderNode } from './render';
import { ChatPanel } from './chat';

/**
 * The web surface is a RENDERING surface for the agent-built app — not a chat.
 * A floating button opens a chat panel ON DEMAND so the user can ask the agent
 * to refine the view ("add a price filter", "make the cards bigger"); the agent
 * re-runs present_view and the view updates live.
 */
function App(): JSX.Element {
  const { connected, view, canGoBack, messages, status, dispatch, navigate, goBack, sendPrompt } = useViewSocket();
  const [chatOpen, setChatOpen] = useState(false);
  const [seen, setSeen] = useState(0);
  useEffect(() => {
    if (chatOpen) setSeen(messages.length);
  }, [chatOpen, messages.length]);
  const unread = !chatOpen && messages.length > seen;

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
          <div className="empty">{status ? status.text : 'No view yet — ask the agent to build you an app.'}</div>
        )}
        {view && status && (
          <div className={status.error ? 'turn-status err' : 'turn-status'}>{status.error ? `⚠ ${status.text}` : status.text}</div>
        )}
      </main>
      {chatOpen ? (
        <ChatPanel messages={messages} status={status} onSend={sendPrompt} onClose={() => setChatOpen(false)} />
      ) : (
        <button className="chat-fab" onClick={() => setChatOpen(true)} aria-label="Chat with the agent">
          <span aria-hidden>💬</span>
          {unread && <span className="chat-dot" />}
        </button>
      )}
    </div>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
