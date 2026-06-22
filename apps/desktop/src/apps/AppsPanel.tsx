import { useState } from 'react';
import { sendToSession } from '@moxxy/client-core';
import { ViewHeader, ViewSwitcher, type View } from '../shell/ViewHeader';
import { getDesktopApp, listDesktopApps } from './registry';
import { AppCard } from './AppCard';
import './builtins';

/**
 * Apps surface — two modes:
 *   - gallery: a grid of registered app cards (each drives its own install
 *     lifecycle when it needs assets).
 *   - open: the selected app's full-pane component, with `onExit` back to gallery.
 *
 * One new `View` (`'apps'`) hosts every app via the sub-route below, so adding
 * app #2..N never touches navigation.
 */
export function AppsPanel({
  onView = () => undefined,
  disabledViews,
  disabledViewReason,
}: {
  readonly onView?: (v: View) => void;
  readonly disabledViews?: ReadonlyArray<View>;
  readonly disabledViewReason?: string;
}): JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null);

  const open = openId ? getDesktopApp(openId) : undefined;
  if (open) {
    const App = open.Component;
    // Only apps that opted in (`canSendToSession`) get the capability — the
    // module-level `sendToSession` resolves the active workspace itself.
    return (
      <App
        onExit={() => setOpenId(null)}
        {...(open.canSendToSession ? { sendToSession } : {})}
      />
    );
  }

  const apps = listDesktopApps();
  return (
    <>
      <ViewHeader>
        <ViewSwitcher
          view="apps"
          onView={onView}
          disabledViews={disabledViews}
          disabledReason={disabledViewReason}
        />
        <span style={{ flex: 1 }} />
      </ViewHeader>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '1.5rem 2rem' }}>
        {apps.length === 0 ? (
          <p style={{ color: 'var(--color-text-dim)' }}>No apps available.</p>
        ) : (
          <ul
            role="list"
            style={{
              margin: 0,
              padding: 0,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: '1rem',
            }}
          >
            {apps.map((def) => (
              <AppCard key={def.id} def={def} onOpen={() => setOpenId(def.id)} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
