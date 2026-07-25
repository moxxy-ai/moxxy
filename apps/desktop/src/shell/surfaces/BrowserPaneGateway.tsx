import { useEffect, useState } from 'react';
import { api } from '@moxxy/client-core';

import { BrowserPane } from './BrowserPane';
import { NativeBrowserPane } from './NativeBrowserPane';

type SelectedBackend = 'checking' | 'native' | 'playwright';

/** Selects the browser backend exactly once for this mount. A command-level
 * failure after native selection remains a visible native error and never
 * silently moves the user onto a separate Playwright page. */
export function BrowserPaneGateway({
  workspaceId,
}: {
  readonly workspaceId: string | null;
}): JSX.Element {
  const [backend, setBackend] = useState<SelectedBackend>('checking');

  useEffect(() => {
    let active = true;
    if (!workspaceId) {
      setBackend('playwright');
      return () => {
        active = false;
      };
    }
    void api()
      .invoke('nativeBrowser.status')
      .then((status) => {
        if (!active) return;
        setBackend(status.backend === 'native' && status.available ? 'native' : 'playwright');
      })
      .catch(() => {
        if (active) setBackend('playwright');
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  if (backend === 'checking') {
    return (
      <div className="native-browser__loading" role="status">
        <span>Starting browser…</span>
      </div>
    );
  }
  if (backend === 'native' && workspaceId) {
    return <NativeBrowserPane workspaceId={workspaceId} />;
  }
  return <BrowserPane workspaceId={workspaceId} />;
}
