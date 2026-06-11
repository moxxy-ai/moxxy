/**
 * Frontend entry. Three boot modes:
 *   ?gallery=1 — sprite/art review page (no Phaser, no backend)
 *   ?demo=1    — the office driven by a scripted feed (no backend)
 *   default    — live mode: connect to the channel's WS bridge and mirror
 *                real moxxy sessions (wired in bridge/storeTap).
 */

import { OfficeDirector } from './sim/director.js';
import { mulberry32 } from './sim/rng.js';
import { OFFICE_MAP } from './map/office-map.js';
import { walkableFrom } from './map/collision.js';
import { ZONES } from './map/zones.js';

const gameEl = document.getElementById('game');
if (!gameEl) throw new Error('missing #game mount');
gameEl.textContent = '';

/** Mount the React overlay (HUD + chat panel) into #ui. Live mode mounts the
 *  client-core bridges too, so call this only after the transport exists. */
async function mountOverlay(live: boolean): Promise<void> {
  const uiEl = document.getElementById('ui');
  if (!uiEl) return;
  const [{ createRoot }, { App }] = await Promise.all([
    import('react-dom/client'),
    import('./ui/App.js'),
  ]);
  createRoot(uiEl).render(<App live={live} />);
}

const params = new URLSearchParams(window.location.search);

async function boot(): Promise<void> {
  if (params.get('gallery')) {
    const { renderGallery } = await import('./gallery.js');
    renderGallery(gameEl!);
    return;
  }

  const director = new OfficeDirector({
    walkable: walkableFrom(OFFICE_MAP),
    zones: ZONES,
    rng: mulberry32(20260611),
  });

  const { createGame } = await import('./game/createGame.js');
  const { game, scene } = createGame(gameEl!, director, {
    onActorClick: (id) => {
      void import('./bridge/officeUiStore.js').then(({ officeUiStore }) =>
        officeUiStore.select(id),
      );
    },
    onBackgroundClick: () => {
      void import('./bridge/officeUiStore.js').then(({ officeUiStore }) =>
        officeUiStore.select(null),
      );
    },
  });

  // Keep the scene's selection ring in sync with the UI store.
  void import('./bridge/officeUiStore.js').then(({ officeUiStore }) => {
    officeUiStore.subscribe(() => scene.setSelected(officeUiStore.get().selectedId));
  });
  void game;

  if (params.get('demo')) {
    const { startDemo } = await import('./demo/demoFeed.js');
    startDemo(director);
    await mountOverlay(false);
    return;
  }

  const { bootLive } = await import('./bridge/storeTap.js');
  await bootLive(director);
  // After bootLive so configureTransport has run before the bridges mount.
  await mountOverlay(true);
}

void boot();
