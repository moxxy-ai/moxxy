import { useState } from 'react';
import { sendToSession } from '@moxxy/client-core';
import { getDesktopApp, listDesktopApps } from './registry';
import { AppCard } from './AppCard';
import './builtins';
import { InstrumentBar } from '../shell/InstrumentBar';

/**
 * Apps: the installable-app gallery, and nothing else.
 *
 * It used to carry Channels, Workflows, Schedules and Webhooks as sub-nav chips,
 * which meant one destination held two unrelated families — an app is something
 * you OPEN, an automation is something that runs without you — and, once those
 * became their own rail destinations, the same surfaces were reachable from two
 * places at once. That duplication is the actual defect this removes.
 *
 * A card drives its own install lifecycle when it needs assets; opening one takes
 * the full pane, with `onExit` back to the gallery.
 */
export function AppsPanel(): JSX.Element {
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

  return (
    <>
      <InstrumentBar crumbs={['Apps']} />
      <Gallery onOpen={setOpenId} />
    </>
  );
}

/** The installable-app grid (content-only — the Apps header is owned above). */
function Gallery({ onOpen }: { readonly onOpen: (id: string) => void }): JSX.Element {
  const apps = listDesktopApps();
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 'var(--space-20) var(--space-32)' }}>
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
            gap: 'var(--space-16)',
          }}
        >
          {apps.map((def) => (
            <AppCard key={def.id} def={def} onOpen={() => onOpen(def.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}
