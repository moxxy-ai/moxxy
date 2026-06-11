/**
 * Top-left HUD: the office roster (one chip per worker, status dot + name,
 * click to open their chat), a "+ Spawn agent" button, and the connection
 * banner. Reads {@link officeUiStore} only — it never re-renders per frame,
 * just on roster/selection/connection transitions.
 */

import { useState } from 'react';
import { api } from '@moxxy/client-core/transport';

import { officeUiStore, type OfficeUiState, type WorkerStatus } from '../bridge/officeUiStore.js';

const DOT_CLASS: Record<WorkerStatus, string> = {
  idle: 'vo-dot',
  thinking: 'vo-dot vo-dot--thinking',
  'awaiting-approval': 'vo-dot vo-dot--ask',
};

function Banner({ connection }: { readonly connection: OfficeUiState['connection'] }): JSX.Element | null {
  switch (connection) {
    case 'connecting':
      return <div className="vo-banner vo-banner--warn">connecting…</div>;
    case 'reconnecting':
      return <div className="vo-banner vo-banner--warn">reconnecting…</div>;
    case 'disconnected':
      return <div className="vo-banner vo-banner--danger">disconnected — reload</div>;
    default:
      return null;
  }
}

export function Hud({ ui, live }: { readonly ui: OfficeUiState; readonly live: boolean }): JSX.Element {
  const [spawning, setSpawning] = useState(false);

  const spawn = async (): Promise<void> => {
    if (spawning) return;
    setSpawning(true);
    try {
      // Roster refresh arrives via connection.changed → officeUiStore.setRoster.
      await api().invoke('sessions.create', {});
    } catch {
      /* best-effort — the HUD stays as-is */
    } finally {
      setSpawning(false);
    }
  };

  return (
    <div className="vo-hud">
      <h1 className="vo-hud-title">the office</h1>
      {live ? <Banner connection={ui.connection} /> : null}
      <div className="vo-roster">
        {ui.roster.map((w) => (
          <button
            key={w.id}
            type="button"
            className={`vo-chip${w.id === ui.selectedId ? ' vo-chip--selected' : ''}`}
            onClick={() => officeUiStore.select(w.id)}
            title={`${w.name} — ${w.status}`}
          >
            <span className={DOT_CLASS[w.status]} />
            <span className="vo-chip-name">{w.name}</span>
          </button>
        ))}
      </div>
      {live ? (
        <button type="button" className="vo-spawn" disabled={spawning} onClick={() => void spawn()}>
          {spawning ? 'spawning…' : '+ Spawn agent'}
        </button>
      ) : (
        <div className="vo-demo-badge">demo tour</div>
      )}
    </div>
  );
}
