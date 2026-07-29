import { useState } from 'react';
import { sendToSession } from '@moxxy/client-core';
import { Segmented } from '../shell/Segmented';
import { getDesktopApp, listDesktopApps } from './registry';
import { AppCard } from './AppCard';
import { WorkflowsPanel } from '../workflows/WorkflowsPanel';
import { SchedulesPanel } from './SchedulesPanel';
import { WebhooksPanel } from './WebhooksPanel';
import { ChannelsPanel } from './ChannelsPanel';
import './builtins';
import { InstrumentBar } from '../shell/InstrumentBar';

/** Apps sub-surfaces. `gallery` is the installable-app grid (the landing); the
 *  others are the channel + ambient-automation surfaces reached from the
 *  header's right-side sub-nav chips. */
type AppsTab = 'gallery' | 'channels' | 'workflows' | 'schedules' | 'webhooks';

const SUB_TABS = [
  { id: 'channels', label: 'Channels' },
  { id: 'workflows', label: 'Workflows' },
  { id: 'schedules', label: 'Schedules' },
  { id: 'webhooks', label: 'Webhooks' },
] as const;

/**
 * Apps surface. One chrome header owns the top view switcher (Apps active) plus
 * a right-aligned sub-nav (Workflows / Schedules / Webhooks); each sub-view
 * renders content-only beneath it. The landing is the installable-app gallery;
 * selecting a chip swaps the body to that ambient-automation surface, and
 * re-clicking the active chip returns to the gallery.
 *
 *   - gallery: a grid of registered app cards (each drives its own install
 *     lifecycle when it needs assets); opening one takes the full pane.
 *   - workflows / schedules / webhooks: the trigger-driven surfaces.
 */
export function AppsPanel(): JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<AppsTab>('gallery');

  // Opening an installed app (gallery only) takes the full pane, with `onExit`
  // back to the gallery.
  const open = tab === 'gallery' && openId ? getDesktopApp(openId) : undefined;
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
      <InstrumentBar crumbs={['Apps']}>
        <Segmented
          items={SUB_TABS}
          // `value: null` (gallery) renders with no active chip; re-clicking the
          // active chip toggles back to the gallery.
          value={tab === 'gallery' ? null : tab}
          onChange={(id) => setTab((cur) => (cur === id ? 'gallery' : id))}
          testIdPrefix="apps-tab-"
        />
      </InstrumentBar>
      {tab === 'gallery' && <Gallery onOpen={setOpenId} />}
      {tab === 'channels' && <ChannelsPanel />}
      {tab === 'workflows' && <WorkflowsPanel embedded />}
      {tab === 'schedules' && <SchedulesPanel />}
      {tab === 'webhooks' && <WebhooksPanel />}
    </>
  );
}

/** The installable-app grid (content-only — the Apps header is owned above). */
function Gallery({ onOpen }: { readonly onOpen: (id: string) => void }): JSX.Element {
  const apps = listDesktopApps();
  return (
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
            <AppCard key={def.id} def={def} onOpen={() => onOpen(def.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}
