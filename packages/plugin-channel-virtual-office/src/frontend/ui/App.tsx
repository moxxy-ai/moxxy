/**
 * React overlay root, mounted into `#ui` over the Phaser canvas. The container
 * is pointer-events: none; each direct child (style tag, HUD, panel) gets
 * pointer-events: auto via the index.html rule, so the game stays clickable
 * everywhere the overlay isn't.
 *
 * In live mode this also mounts the client-core bridges (ChatStoreBridge wires
 * runner.event/turn.complete + the ask store; ConnectionBridge primes per-
 * workspace connection snapshots) — both need the transport configured first,
 * which bootLive() guarantees before render.
 */

import { useSyncExternalStore } from 'react';
import { ChatStoreBridge, ConnectionBridge } from '@moxxy/client-core';

import { officeUiStore, type OfficeUiState } from '../bridge/officeUiStore.js';
import { Hud } from './Hud.js';
import { ChatPanel } from './ChatPanel.js';
import { PANEL_CSS } from './panelStyles.js';

const subscribe = (fn: () => void): (() => void) => officeUiStore.subscribe(fn);
const getState = (): OfficeUiState => officeUiStore.get();

export function App({ live }: { readonly live: boolean }): JSX.Element {
  const ui = useSyncExternalStore(subscribe, getState);
  const selected = ui.selectedId
    ? (ui.roster.find((r) => r.id === ui.selectedId) ?? null)
    : null;

  return (
    <>
      <style>{PANEL_CSS}</style>
      {live ? (
        <>
          <ChatStoreBridge />
          <ConnectionBridge />
        </>
      ) : null}
      <Hud ui={ui} live={live} />
      {selected ? <ChatPanel key={selected.id} worker={selected} live={live} /> : null}
    </>
  );
}
