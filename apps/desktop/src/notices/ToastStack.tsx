/**
 * The toasts in the main window's top-right corner, under the header bar.
 * Render-only; what is shown and for how long lives in the toast store
 * (`useToasts`).
 */

import { useSyncExternalStore } from 'react';
import { Icon } from '@moxxy/desktop-ui';
import type { AgentCliNoticeView } from '../chat/useAgentCliNotice';
import { getAgentUpdateCards, subscribeAgentUpdateCards } from './agent-update-card';
import { AgentUpdateToast } from './AgentUpdateToast';
import { dismissToast, getToasts, subscribeToasts, type Toast } from './toast-store';

export function ToastStack({
  toasts,
  agentUpdates = [],
  onDismiss,
}: {
  readonly toasts: ReadonlyArray<Toast>;
  readonly agentUpdates?: ReadonlyArray<AgentCliNoticeView>;
  readonly onDismiss: (id: string) => void;
}): JSX.Element {
  return (
    <div role="status" aria-live="polite" className="toast-stack">
      {agentUpdates.map((update) => (
        <AgentUpdateToast key={update.notice.provider} notice={update} />
      ))}
      {toasts.map((toast) => {
        const words = (
          <>
            <span className="toast__title">{toast.title}</span>
            {toast.body && <span className="toast__body">{toast.body}</span>}
          </>
        );
        return (
          <div key={toast.id} className="toast" data-tone={toast.tone}>
            <span className="toast__dot" aria-hidden />
            {toast.onOpen ? (
              <button
                type="button"
                className="toast__open"
                onClick={() => {
                  toast.onOpen?.();
                  onDismiss(toast.id);
                }}
              >
                {words}
              </button>
            ) : (
              <span className="toast__open">{words}</span>
            )}
            <button type="button" aria-label="Dismiss" className="toast__dismiss" onClick={() => onDismiss(toast.id)}>
              <Icon name="x" size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** The toasts the store holds, for the one stack the app renders. */
export function useToasts(): ReadonlyArray<Toast> {
  return useSyncExternalStore(subscribeToasts, getToasts);
}

/** The app's toast stack, wired to the store. */
export function Toasts(): JSX.Element {
  const agentUpdates = useSyncExternalStore(subscribeAgentUpdateCards, getAgentUpdateCards);
  return <ToastStack toasts={useToasts()} agentUpdates={agentUpdates} onDismiss={dismissToast} />;
}
