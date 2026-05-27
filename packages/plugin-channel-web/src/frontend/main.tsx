import { createRoot } from 'react-dom/client';
import { useViewSocket } from './socket';
import { renderNode } from './render';

/**
 * The web surface is a RENDERING surface for the agent-built app — not a chat.
 * There is no prompt box: the user asks via their channel (TUI/Telegram), the
 * app renders here, and interaction happens through the app's own forms/buttons.
 */
function App(): JSX.Element {
  const { connected, view, canGoBack, status, dispatch, navigate, goBack } = useViewSocket();
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
          <div className={status.error ? 'turn-status err' : 'turn-status'}>
            {status.error ? `⚠ ${status.text}` : status.text}
          </div>
        )}
      </main>
    </div>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
