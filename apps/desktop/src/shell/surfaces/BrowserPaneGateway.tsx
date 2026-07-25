import { useCallback, useEffect, useState } from 'react';
import { api } from '@moxxy/client-core';

import { BrowserPane } from './BrowserPane';
import { NativeBrowserPane } from './NativeBrowserPane';

type BrowserBackendState =
  | { readonly status: 'checking' }
  | { readonly status: 'ready'; readonly backend: 'native' | 'playwright' }
  | { readonly status: 'error'; readonly message: string };

/** Selects the browser backend exactly once for this mount. A command-level
 * failure after native selection remains a visible native error and never
 * silently moves the user onto a separate Playwright page. */
export function BrowserPaneGateway({
  workspaceId,
}: {
  readonly workspaceId: string | null;
}): JSX.Element {
  const backend = useBrowserBackend(workspaceId);

  if (backend.state.status === 'checking') {
    return (
      <div className="native-browser__loading" role="status">
        <span>Starting browser…</span>
      </div>
    );
  }
  if (backend.state.status === 'error') {
    return (
      <div className="native-browser__backend-error" role="alert">
        <strong>Browser could not start</strong>
        <span>{backend.state.message}</span>
        <button type="button" onClick={backend.retry}>
          Try again
        </button>
      </div>
    );
  }
  if (backend.state.backend === 'native' && workspaceId) {
    return <NativeBrowserPane workspaceId={workspaceId} />;
  }
  return <BrowserPane workspaceId={workspaceId} />;
}

function useBrowserBackend(workspaceId: string | null): {
  readonly state: BrowserBackendState;
  readonly retry: () => void;
} {
  const [state, setState] = useState<BrowserBackendState>({
    status: 'checking',
  });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setState({ status: 'checking' });
    setAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    let active = true;
    if (!workspaceId) {
      setState({ status: 'ready', backend: 'playwright' });
      return () => {
        active = false;
      };
    }
    void api()
      .invoke('nativeBrowser.status')
      .then((status) => {
        if (!active) return;
        setState({
          status: 'ready',
          backend: status.backend === 'native' && status.available ? 'native' : 'playwright',
        });
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setState({ status: 'error', message: errorMessage(reason) });
      });
    return () => {
      active = false;
    };
  }, [attempt, workspaceId]);

  return { state, retry };
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
