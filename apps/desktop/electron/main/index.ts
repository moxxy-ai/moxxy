/**
 * Electron entry point. Owns the lifecycle of:
 *
 *   - the main window (single, for now — multi-window is deferred)
 *   - the [`RunnerSupervisor`] (started before the window opens; the
 *     supervisor's first `connection.changed` event lands at the
 *     renderer the moment the preload bridge is ready)
 *   - the IPC wiring
 */

import { app, BrowserWindow } from 'electron';

// Set the user-facing app name BEFORE app.whenReady so the macOS
// menu bar / Dock and Windows taskbar pick it up. Falls through to
// the packaged productName for the bundled .app/.exe.
app.setName('MoxxyAI Workspaces');
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RunnerPool,
  UNBOUND_ID,
  bindWindow,
  registerIpcHandlers,
  ElectronCommandBus,
  wsEventBus,
  DeskStore,
  sweepStaleSockets,
  bindMainWindowMinimize,
  closeFocusWindow,
  resizeFocusWindow,
  showFocusWindow,
  toggleFocusWindow,
  installContentSecurityPolicy,
  installMediaPermissions,
  lockDownNavigation,
  isSafeExternalUrl,
  clerkFrontendApiHost,
  preferredCliEntry,
  ensureDesktopVaultKey,
  activateManagedNode,
  startLoopbackServer,
  sendEvent,
  type LoopbackServer,
} from '@moxxy/desktop-host';
import type { DeepLinkPayload } from '@moxxy/desktop-ipc-contract';
// Value imports of @moxxy/ipc-server-ws are lazy + guarded (see the bridge
// block below): the bridge is opt-in, and a top-level static import would make
// boot itself depend on the module resolving — the exact failure that bricked
// the 0.0.33 build when the package wasn't in BUNDLED_WORKSPACE_DEPS.
// Type-only imports are erased at build time and carry no such risk.
import type { WebSocketCommandBus, WebSocketBridgeServer } from '@moxxy/ipc-server-ws';

import { resolveWsBridgeConfig } from './ws-bridge.js';

import { BUNDLED_UPDATE_PUBLIC_KEY } from './update-key.js';
import { readConfirmed, markConfirmed, markBad, appendBootLog } from '@moxxy/desktop-host/app-update';
import { initShellUpdater } from './shell-updater.js';

// In a packaged build there is no global `moxxy` (and a GUI launch has no
// shell PATH / system `node`). Point the CLI resolver at a self-contained,
// pinned CLI run via Electron's own Node (ELECTRON_RUN_AS_NODE), preferring a
// version the user updated from within the app over the one bundled with this
// release. Respects an explicit MOXXY_CLI_ENTRY override (dev / power users).
// The in-app "Update CLI" action re-points the same env var via the shared
// preferredCliEntry() helper after installing into writable userData.
if (app.isPackaged && !process.env.MOXXY_CLI_ENTRY) {
  const entry = preferredCliEntry(app.getPath('userData'), process.resourcesPath);
  if (entry) process.env.MOXXY_CLI_ENTRY = entry;
}
import { ipcMain, Tray, Menu, nativeImage, globalShortcut, session, shell, systemPreferences } from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDev = !!process.env['ELECTRON_RENDERER_URL'];

// The Clerk publishable key, baked into the main bundle at build time by
// electron-vite's `define` (see electron.vite.config.ts) from the same
// VITE_CLERK_PUBLISHABLE_KEY the renderer reads. The main process needs it to
// allow the instance's prod Frontend API host through the CSP + OAuth popup
// allow-list — a `pk_live_` key serves clerk-js from the instance's own
// domain, which the static dev/test hosts don't cover. '' when unset.
declare const __CLERK_PUBLISHABLE_KEY__: string;
const CLERK_PUBLISHABLE_KEY =
  typeof __CLERK_PUBLISHABLE_KEY__ === 'string' ? __CLERK_PUBLISHABLE_KEY__ : '';

let pool: RunnerPool | null = null;
let mainWindow: BrowserWindow | null = null;
/** The optional WebSocket bridge server (remote/mobile clients). Closed on quit. */
// Typed as the bridge server (not the bare TransportServer) so the host can
// call `rotateWsBridgeToken(userData, wsServer)` to invalidate a leaked token.
let wsServer: WebSocketBridgeServer | null = null;

// In-app loopback HTTP server the packaged renderer is served from (so the
// Clerk web SDK runs on an http origin). null in dev (Vite serves it) and
// when every candidate port was taken (we fall back to file://).
let loopback: LoopbackServer | null = null;
// Fixed, stable loopback ports — each MUST be allow-listed in the Clerk
// dashboard (origins are exact-match including the port).
const LOOPBACK_PORTS = [51789, 51790, 51791, 51792] as const;

// ---- moxxy:// deep-link transport -----------------------------------------

// `moxxy://` links that arrived before the renderer's DeepLinkBridge was
// listening (cold-start launch, or before the bridge mounted). Drained via
// the `deepLink:drain` IPC on mount; live links thereafter push directly.
const pendingDeepLinks: DeepLinkPayload[] = [];
// Flips true once the renderer's bridge drains (it subscribes THEN drains in
// one synchronous effect, so by the time this is true the live-event listener
// exists — no lost-link race). Reset on every (re)load so links re-buffer.
let rendererReady = false;

/** Bring the main window to the foreground (deep-link / second-instance). */
function focusMain(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (process.platform === 'darwin') app.focus({ steal: true });
}

/** Parse a `moxxy://host/path?a=b` URL into its transport payload, or null
 *  if it isn't a well-formed moxxy URL. */
function parseDeepLink(url: string): DeepLinkPayload | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'moxxy:') return null;
    const params: Record<string, string> = {};
    u.searchParams.forEach((v, k) => {
      params[k] = v;
    });
    return { url, host: u.hostname, path: u.pathname || '/', params };
  } catch {
    return null;
  }
}

/** Route an opened `moxxy://` URL: focus the window, then push it to the
 *  renderer live (if the bridge is listening) or buffer it for the next
 *  drain. */
function handleDeepLink(url: string): void {
  const payload = parseDeepLink(url);
  if (!payload) return;
  focusMain();
  if (rendererReady && mainWindow && !mainWindow.isDestroyed()) {
    sendEvent(mainWindow, 'deepLink:received', payload);
  } else {
    pendingDeepLinks.push(payload);
  }
}

/** Strip the Electron + app product tokens from a user-agent, leaving a plain
 *  desktop-Chrome UA. Google blocks OAuth from "embedded" user-agents
 *  ("this browser may not be secure"); presenting a clean UA lets the in-app
 *  sign-in popup through. Harmless for our own + Clerk requests. */
function cleanOAuthUserAgent(ua: string): string {
  const name = app.getName().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return ua
    .replace(new RegExp(`\\s*${name}(?:/\\S+)?`, 'i'), '')
    .replace(/\s*Electron\/\S+/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function createWindow(): Promise<void> {
  // The renderer is served either from Vite's dev server or from the
  // packaged dist/. The window icon needs a filesystem path though
  // (Electron doesn't accept http:// urls for `icon`), so we resolve
  // it relative to the built dist/ in prod and the renderer source
  // in dev.
  const iconPath = isDev
    ? path.join(__dirname, '..', '..', '..', 'public', 'logo.png')
    : path.join(__dirname, '..', '..', 'dist', 'logo.png');

  // Hosts where Clerk's OAuth popup is allowed to open. Anything else
  // returns `action: 'deny'` so we don't accidentally let arbitrary
  // window.open() calls spawn full Electron windows.
  const OAUTH_HOST_PATTERNS = [
    /^https:\/\/.*\.clerk\.accounts\.dev$/,
    /^https:\/\/.*\.clerk\.com$/,
    /^https:\/\/accounts\.google\.com$/,
    /^https:\/\/appleid\.apple\.com$/,
    /^https:\/\/github\.com$/,
  ];
  // A `pk_live_` instance runs OAuth through its OWN Frontend API host
  // (e.g. clerk.acme.com) and account portal (accounts.acme.com), neither
  // covered above — add the exact host plus a wildcard on its parent domain
  // so the prod sign-in popup isn't denied. Test keys resolve to a host
  // already matched above, so this adds nothing for them.
  const clerkFapiHost = clerkFrontendApiHost(CLERK_PUBLISHABLE_KEY);
  if (
    clerkFapiHost &&
    !clerkFapiHost.endsWith('.clerk.accounts.dev') &&
    !clerkFapiHost.endsWith('.clerk.com')
  ) {
    const reEsc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    OAUTH_HOST_PATTERNS.push(new RegExp(`^https://${reEsc(clerkFapiHost)}$`));
    const parent = clerkFapiHost.split('.').slice(1).join('.');
    if (parent.split('.').length >= 2) {
      OAUTH_HOST_PATTERNS.push(new RegExp(`^https://(?:[a-z0-9-]+\\.)+${reEsc(parent)}$`));
    }
  }

  mainWindow = new BrowserWindow({
    title: 'MoxxyAI Workspaces',
    width: 1180,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#f1f2f9',
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      // The preload bridge only touches ipcRenderer + contextBridge, so
      // the OS process sandbox is safe to enable — it shrinks the blast
      // radius of a renderer compromise to "can't reach Node directly."
      sandbox: true,
    },
  });

  // Refuse top-frame navigation away from our own origin. The OAuth
  // popups open via the `setWindowOpenHandler` below (kept intact), not
  // by navigating this frame, so sign-in is unaffected.
  lockDownNavigation(mainWindow, { keepWindowOpenHandler: true });

  // OAuth popup handling — Clerk's clerk-js calls window.open() to
  // run the provider's OAuth flow. We allow popups whose origin is on
  // the OAUTH_HOST_PATTERNS list (Clerk's own domain + the major
  // providers' login pages), open them as child BrowserWindows that
  // share this window's session (so cookies/localStorage are visible
  // to the renderer when the popup closes), and deny everything else.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const origin = new URL(url).origin;
      if (OAUTH_HOST_PATTERNS.some((re) => re.test(origin))) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 480,
            height: 640,
            minWidth: 380,
            minHeight: 480,
            autoHideMenuBar: true,
            parent: mainWindow ?? undefined,
            modal: false,
            webPreferences: {
              contextIsolation: true,
              sandbox: true,
              // No preload: this is third-party Clerk/OAuth UI; we don't
              // want our IPC surface exposed.
            },
          },
        };
      }
    } catch {
      return { action: 'deny' };
    }
    // Any other http/https link (e.g. a markdown link in the chat, opened
    // via target="_blank") goes to the user's default browser rather than an
    // in-app window. Non-http(s) schemes are refused outright.
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Buffer deep-links until the renderer's bridge has drained, so none are
  // lost across a load / reload. Resets on every load start.
  mainWindow.webContents.on('did-start-loading', () => {
    rendererReady = false;
  });

  if (isDev) {
    await mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']!);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else if (loopback) {
    // Prod: serve from the loopback http origin (Clerk-friendly secure
    // context). The static server roots at this bundle's own dist/.
    await mainWindow.loadURL(loopback.url('index.html'));
  } else {
    // Degraded fallback only if every loopback port was taken — the window
    // still renders, but Clerk sign-in won't work on a file:// origin.
    await mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }

  if (pool) {
    const unbind = bindWindow(pool, mainWindow);
    mainWindow.on('closed', () => {
      unbind();
      mainWindow = null;
    });
  }

  // Focus mode wiring — when the user minimizes / hides the main
  // window, surface the floating widget instead.
  const focusOpts = {
    devUrl: isDev ? process.env['ELECTRON_RENDERER_URL'] : undefined,
    preloadPath: path.join(__dirname, '..', 'preload', 'index.cjs'),
    indexHtml: path.join(__dirname, '..', '..', 'dist', 'index.html'),
    focusHtml: path.join(__dirname, '..', '..', 'dist', 'focus.html'),
    // Prod: load the widget from the same loopback origin as the main window
    // (shared secure-context origin); falls back to focusHtml on disk.
    loopbackBase: loopback?.origin,
    /** Bind the focus widget to the same runner pool as the main
     *  window so it sees connection state + every runner event, but
     *  pass claimGlobal: false so the IPC RPC routing (runTurn /
     *  abortTurn / …) still goes through the main window's driver. */
    attach: (win: BrowserWindow) => {
      if (!pool) return () => undefined;
      return bindWindow(pool, win, { claimGlobal: false });
    },
  };
  bindMainWindowMinimize(mainWindow, focusOpts);

  // Focus mode floats a tiny always-on-top widget over your desktop.
  // On macOS, native fullscreen puts the main window in its own Space;
  // spawning the floating widget there never surfaces the bar and instead
  // wedges the app — the main window's controls vanish and it won't close
  // (needs a force-quit). So focus mode is unavailable while the main
  // window is fullscreen: the menu items grey out and every handler
  // (including the global shortcut, which has no disabled state) no-ops.
  const focusModeAvailable = (): boolean =>
    !(
      process.platform === 'darwin' &&
      !!mainWindow &&
      !mainWindow.isDestroyed() &&
      mainWindow.isFullScreen()
    );

  const openMainAndCloseFocus = (): void => {
    closeFocusWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    // macOS: ensure the app is foregrounded even if the window
    // was hidden behind another Space.
    if (process.platform === 'darwin') app.focus({ steal: true });
  };

  const requestFocusToggle = (): void => {
    if (!focusModeAvailable()) return;
    void toggleFocusWindow(focusOpts);
  };

  // (Re)build the tray context menu + application menu, greying out the
  // focus-mode entries whenever focus mode isn't currently available.
  const applyMenus = (): void => {
    const focusEnabled = focusModeAvailable();
    if (trayInstance) {
      trayInstance.setContextMenu(
        Menu.buildFromTemplate([
          // Heading row — disabled item that just labels the menu so
          // the user knows which app this tray belongs to. macOS dims
          // disabled items so it reads as a header.
          { label: 'MoxxyAI Workspaces', enabled: false },
          { type: 'separator' },
          { label: 'Open main window', click: openMainAndCloseFocus },
          { label: 'Toggle focus mode', enabled: focusEnabled, click: requestFocusToggle },
          { type: 'separator' },
          { role: 'quit' },
        ]),
      );
    }
    installApplicationMenu(requestFocusToggle, openMainAndCloseFocus, focusEnabled);
  };

  // Entering fullscreen drops any open widget and disables the toggles;
  // leaving re-enables them.
  mainWindow.on('enter-full-screen', () => {
    closeFocusWindow();
    applyMenus();
  });
  mainWindow.on('leave-full-screen', applyMenus);

  // Tray menu — toggle the widget, restore the main window, quit.
  if (!trayInstance) {
    try {
      // Try several candidate paths because the prod / dev build
      // layouts differ — log which one wins (or report all-empty)
      // so future icon regressions are noisy instead of silent.
      const trayIconCandidates = [
        path.join(__dirname, '..', '..', '..', 'public', 'logo.png'),
        path.join(__dirname, '..', '..', 'dist', 'logo.png'),
        path.join(process.resourcesPath ?? '', 'public', 'logo.png'),
        path.join(process.resourcesPath ?? '', 'logo.png'),
      ];
      let raw = nativeImage.createEmpty();
      let resolvedPath = '';
      for (const p of trayIconCandidates) {
        const candidate = nativeImage.createFromPath(p);
        if (!candidate.isEmpty()) {
          raw = candidate;
          resolvedPath = p;
          break;
        }
      }
      // eslint-disable-next-line no-console
      console.log(
        raw.isEmpty()
          ? `[moxxy] tray: NO icon found, fell back to text label. Tried: ${trayIconCandidates.join(', ')}`
          : `[moxxy] tray: icon loaded from ${resolvedPath}`,
      );
      const icon = raw.isEmpty()
        ? nativeImage.createEmpty()
        : raw.resize({ width: 22, height: 22, quality: 'best' });
      // Do NOT setTemplateImage on a colored avatar — the alpha is
      // a near-solid rectangle, which AppKit tints to a featureless
      // blob (or, on some versions, drops to invisible). Render the
      // image as-is; a 18×18 coloured avatar is recognisable on the
      // menu bar.
      trayInstance = new Tray(icon);
      // Fallback title — if the icon couldn't be loaded, at least
      // something is visible in the menu bar (template-image
      // failures + missing PNGs both hit this path).
      if (raw.isEmpty()) trayInstance.setTitle('moxxy');
      trayInstance.setToolTip('MoxxyAI Workspaces');
      // The context menu is built by applyMenus() below (and rebuilt on
      // fullscreen changes) so the focus-mode item can grey out when the
      // main window is fullscreen.
      //
      // We intentionally do NOT bind a left-click → toggle handler
      // here. A bare tray click should just open the menu (the OS
      // default). Focus mode is summoned explicitly via the menu's
      // "Toggle focus mode" item or the keyboard shortcut, so the
      // user is never surprised by it popping up.
    } catch (err) {
      // Surface the failure — silent catch was hiding "icon missing"
      // and "Tray() blew up" alike, leaving the user with no menubar
      // affordance.
      // eslint-disable-next-line no-console
      console.error('[moxxy] tray init failed:', err);
    }
  }

  // Install the tray + application menus now. Focus mode is enabled
  // unless the window already launched into fullscreen.
  applyMenus();

  ipcMain.removeHandler('focus.close');
  ipcMain.handle('focus.close', () => {
    closeFocusWindow();
  });
  ipcMain.removeHandler('focus.restoreMain');
  ipcMain.handle('focus.restoreMain', () => {
    closeFocusWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    if (process.platform === 'darwin') app.focus({ steal: true });
  });
  ipcMain.removeHandler('focus.resize');
  ipcMain.handle(
    'focus.resize',
    (
      _evt,
      { width, height, resizable }: { width: number; height: number; resizable?: boolean },
    ) => {
      resizeFocusWindow(width, height, resizable);
    },
  );

  // System-wide shortcut so the user can summon the widget even when
  // moxxy isn't the focused app. Cmd+Shift+M on mac / Ctrl+Shift+M
  // elsewhere — the same chord the menu shows.
  try {
    globalShortcut.unregister('CommandOrControl+Shift+M');
    globalShortcut.register('CommandOrControl+Shift+M', () => {
      if (!focusModeAvailable()) return;
      void toggleFocusWindow(focusOpts).then(() => {
        if (!mainWindow?.isVisible()) void showFocusWindow(focusOpts);
      });
    });
  } catch {
    /* shortcut may already be claimed — non-fatal */
  }
}

function installApplicationMenu(
  toggleFocus: () => void,
  openMain: () => void,
  focusEnabled: boolean,
): void {
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: 'MoxxyAI Workspaces',
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ] satisfies Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open main window', click: openMain },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Focus Mode',
          accelerator: 'CommandOrControl+Shift+M',
          enabled: focusEnabled,
          click: toggleFocus,
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: isMac
        ? [
            { role: 'minimize' },
            { role: 'zoom' },
            { type: 'separator' },
            { role: 'front' },
          ]
        : [{ role: 'minimize' }, { role: 'close' }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

let trayInstance: Tray | null = null;

/** How long a hot-updated bundle has to prove a healthy render before the probe
 *  assumes it white-screened and reverts to the floor. Generous so a slow cold
 *  start / Clerk network round-trip can't false-trip it. */
const BOOT_PROBE_TIMEOUT_MS = 15_000;
/** How often the probe polls the renderer DOM for a healthy mount. */
const BOOT_PROBE_POLL_MS = 1_500;

/**
 * In-session safety net for a hot-updated bundle: confirm it reached a healthy
 * render, else poison it and relaunch onto the previous-good bundle (or floor).
 *
 * Health is judged from the MAIN process by inspecting the renderer DOM — NOT by
 * waiting for the renderer's `app.appBooted` IPC heartbeat. That heartbeat proved
 * unreliable in packaged builds: it could fail to land on a perfectly healthy
 * bundle, so the old "no heartbeat in 15s ⇒ poison" logic poisoned *every* update
 * (see the boot-log / `bad.json` evidence) and self-update never stuck. The DOM
 * check has no such dependency: `index.html` ships a static `#splash-fallback`
 * inside `#root`, and React replaces it on mount — so "`#splash-fallback` is gone"
 * is a direct, renderer-cooperation-free signal that the app rendered. The IPC
 * heartbeat (`app.appBooted` → `confirmed.json`) is kept only as a fast path.
 *
 * No-op on the bundled floor (no override version), so there's no relaunch loop.
 * The cross-launch `recoverFromFailedBoot` is the belt to this braces.
 */
function armBootProbe(window: BrowserWindow): void {
  const version = process.env.MOXXY_APP_BUNDLE_VERSION;
  if (!version) return; // running the floor — nothing to probe
  const userData = app.getPath('userData');
  const shell = { electron: process.versions.electron, nodeAbi: process.versions.modules ?? '' };

  window.webContents.once('did-finish-load', () => {
    const deadline = Date.now() + BOOT_PROBE_TIMEOUT_MS;

    const reactMounted = async (): Promise<boolean> =>
      window.webContents
        .executeJavaScript(
          // True once React has taken over #root (it replaces the static
          // #splash-fallback on mount). Defensive: never throws into the probe.
          "(()=>{try{return !!document.getElementById('root')" +
            " && !document.getElementById('splash-fallback')" +
            " && document.getElementById('root').childElementCount>0;}catch(e){return false;}})()",
          true,
        )
        .catch(() => false);

    const tick = async (): Promise<void> => {
      if (window.isDestroyed()) return;
      // Fast path: the renderer's heartbeat already confirmed it.
      if (readConfirmed(userData) === version) return;

      if (await reactMounted()) {
        // The bundle rendered — confirm from the main process, independent of the
        // (flaky) renderer heartbeat that was poisoning healthy updates.
        try {
          markConfirmed(userData, version);
        } catch {
          /* best effort */
        }
        appendBootLog(userData, { phase: 'confirm', picked: version, reason: 'main-side-dom', ...shell });
        return;
      }

      if (window.isDestroyed() || readConfirmed(userData) === version) return;
      if (Date.now() < deadline) {
        setTimeout(() => void tick(), BOOT_PROBE_POLL_MS);
        return;
      }

      // Never rendered within the window — treat as a real white-screen.
      console.error(
        `[moxxy] boot-probe: bundle ${version} never rendered within ` +
          `${BOOT_PROBE_TIMEOUT_MS}ms; reverting to the previous bundle`,
      );
      appendBootLog(userData, { phase: 'probe', picked: version, reason: 'no-render-within-timeout', ...shell });
      try {
        markBad(userData, version);
      } catch {
        /* best effort */
      }
      app.relaunch();
      app.quit();
    };

    void tick();
  });
}

// Single-instance lock — required for `moxxy://` deep-links: a link opened
// while the app is already running must hand its URL to the existing instance
// (via `second-instance`) instead of spawning a second app. The loser quits.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  // Register `moxxy://` as our protocol. In an unpackaged dev run we must
  // point the OS at the electron binary + this entry script so the scheme
  // resolves back to us; a packaged app registers via electron-builder's
  // `protocols` / CFBundleURLTypes.
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('moxxy', process.execPath, [path.resolve(process.argv[1]!)]);
  } else {
    app.setAsDefaultProtocolClient('moxxy');
  }
  // macOS delivers deep-links via open-url (can fire before whenReady — the
  // handler buffers until the renderer drains).
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });
  // Windows/Linux: a link opened while running relaunches with the URL in
  // argv, delivered here to the primary instance.
  app.on('second-instance', (_event, argv) => {
    focusMain();
    const url = argv.find((a) => a.startsWith('moxxy://'));
    if (url) handleDeepLink(url);
  });
}

app.whenReady().then(async () => {
  // Losing instance of the single-instance lock — it already called
  // app.quit() above; do nothing here so it exits cleanly.
  if (!gotSingleInstanceLock) return;

  // Present a plain desktop-Chrome user-agent (no Electron/app product
  // tokens) to every request. Google blocks OAuth from "embedded"
  // user-agents ("this browser may not be secure"); a clean UA lets the
  // in-app sign-in popup through. Set before any window so the very first
  // request carries it. Harmless for our own + Clerk requests.
  app.userAgentFallback = cleanOAuthUserAgent(app.userAgentFallback);

  // Serve the packaged renderer over a loopback http origin (a Chromium
  // secure context + an allowed OAuth redirect scheme) so the Clerk web SDK
  // works — file:// rejects clerk-js's OAuth redirect. Dev keeps Vite; if
  // every candidate port is taken we fall back to file:// (sign-in degrades
  // but the app still boots).
  if (!isDev) {
    try {
      loopback = await startLoopbackServer({
        root: path.join(__dirname, '..', '..', 'dist'),
        ports: [...LOOPBACK_PORTS],
      });
      console.log(`[moxxy] renderer served at ${loopback.origin}`);
    } catch (err) {
      console.error('[moxxy] loopback server failed; falling back to file://', err);
      loopback = null;
    }
  }

  // Apply the Content-Security-Policy to our own document responses
  // before any window loads. Skipped in dev (Vite HMR needs a loose
  // policy); third-party + OAuth responses are left untouched. The gate
  // matches both file:// and the loopback origin, and the prod Clerk
  // Frontend API host is folded in from the publishable key.
  installContentSecurityPolicy(session.defaultSession, {
    isDev,
    clerkPublishableKey: CLERK_PUBLISHABLE_KEY,
    loopbackOrigin: loopback?.origin ?? null,
  });

  // Allow the renderer's voice recorder to reach the microphone. Without this,
  // macOS hands getUserMedia a SILENT stream (no rejection), so voice
  // transcription comes back empty ("No speech detected"). The macOS OS-level
  // request is injected here (electron stays out of desktop-host's pure security
  // helpers); pairs with NSMicrophoneUsageDescription + the audio-input
  // entitlement in the build config.
  installMediaPermissions(session.defaultSession, {
    askForMicAccess:
      process.platform === 'darwin'
        ? () => systemPreferences.askForMediaAccess('microphone')
        : undefined,
  });

  // Seed a disk-backed vault key on a fresh setup so saving a provider key /
  // `moxxy login` works without an interactive passphrase prompt the desktop
  // can't answer — the first provider install otherwise fails on Windows (no OS
  // keychain) with "vault: passphrase required but no interactive terminal".
  ensureDesktopVaultKey();

  // If the user auto-installed Node on a previous run (onboarding's "Install
  // automatically"), put that managed Node back on PATH before any runner
  // spawns so `moxxy serve` / npm resolve it without a manual PATH edit.
  activateManagedNode(app.getPath('userData'));

  // Reap any orphan runners from a previous crashed desktop process
  // before we try to spawn new ones. Without this, the first workspace
  // a returning user opens hits EADDRINUSE because a zombie moxxy serve
  // still has 4040 (or the workspace's unix socket) bound.
  const swept = await sweepStaleSockets();
  if (swept.killed.length || swept.removed.length) {
    // eslint-disable-next-line no-console
    console.log(
      `[moxxy] swept ${swept.removed.length} stale socket(s), killed ${swept.killed.length} orphan pid(s)`,
    );
  }
  for (const err of swept.errors) {
    // eslint-disable-next-line no-console
    console.warn('[moxxy] sweep:', err);
  }

  pool = new RunnerPool();
  const desks = new DeskStore();
  // Prime: spawn a runner for the active workspace if one is bound,
  // otherwise an unbound runner so the user lands in a working chat
  // surface from the first paint.
  const initialActive = await desks.getActive();
  if (initialActive) {
    await pool.getOrCreate(initialActive.id, initialActive.cwd);
    pool.setActive(initialActive.id);
  } else {
    await pool.getOrCreate(UNBOUND_ID, null);
    pool.setActive(UNBOUND_ID);
  }
  // The Electron transport is always present. The WebSocket bridge (remote
  // clients / the mobile app) is opt-in via MOXXY_WS_BRIDGE; when enabled, the
  // SAME handler bodies are registered onto it too. Register handlers BEFORE the
  // server starts accepting so an early client connection sees a populated bus.
  // The bridge module is lazy-imported and fully guarded (the shell-updater
  // pattern): the bridge is optional, so a module that fails to load must
  // degrade to "bridge off", never take down the app.
  const electronBus = new ElectronCommandBus();
  const wsConfig = resolveWsBridgeConfig(app.getPath('userData'));
  let wsBridge: typeof import('@moxxy/ipc-server-ws') | null = null;
  if (wsConfig) {
    try {
      wsBridge = await import('@moxxy/ipc-server-ws');
    } catch (e) {
      console.error('[moxxy] WebSocket bridge unavailable (module failed to load):', e);
    }
  }
  const wsBus: WebSocketCommandBus | null = wsBridge ? new wsBridge.WebSocketCommandBus() : null;
  registerIpcHandlers(wsBus ? [electronBus, wsBus] : [electronBus], pool, desks, {
    update: {
      publicKeyPem: BUNDLED_UPDATE_PUBLIC_KEY,
      // Dev/test escape hatch: point the updater at a local manifest. Ignored in
      // packaged builds (the handler pins the source) so it can't be abused.
      manifestUrl: process.env.MOXXY_UPDATE_URL,
    },
  });
  if (wsBridge && wsBus && wsConfig) {
    wsEventBus.addSink(wsBus);
    try {
      wsServer = await wsBridge.startWsBridge(wsBus, wsConfig);
      console.log(`[moxxy] WebSocket bridge listening on ${wsServer.address}`);
    } catch (e) {
      console.error('[moxxy] WebSocket bridge failed to start:', e);
    }
  }

  // The renderer's DeepLinkBridge calls this once on mount: it returns +
  // clears any `moxxy://` links buffered before the renderer was listening
  // (cold-start), and flips `rendererReady` so subsequent links push live.
  // Because the bridge subscribes to `deepLink:received` BEFORE invoking this
  // (one synchronous effect), no link can slip through between the two.
  ipcMain.removeHandler('deepLink:drain');
  ipcMain.handle('deepLink:drain', (): DeepLinkPayload[] => {
    rendererReady = true;
    return pendingDeepLinks.splice(0);
  });

  await createWindow();
  if (mainWindow) armBootProbe(mainWindow);

  // Cold-start deep-link: Windows/Linux pass a `moxxy://` URL as an argv
  // token (macOS uses open-url, already buffered above). Buffer it for the
  // renderer's first drain.
  const argvUrl = process.argv.find((a) => a.startsWith('moxxy://'));
  if (argvUrl) handleDeepLink(argvUrl);

  // Tier-2: background download of a new native shell where supported
  // (Windows/Linux); a no-op on dev + unsigned macOS. Tier-1 JS hot-updates
  // (the common case) are independent of this.
  initShellUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let isQuitting = false;
app.on('before-quit', (event) => {
  // Electron does NOT await the before-quit handler; if we just
  // returned a Promise, the process would exit before stop() landed
  // and the child runner would survive as a zombie. Trap the first
  // quit, run cleanup, then fire app.exit() explicitly.
  if (isQuitting) return;
  isQuitting = true;
  event.preventDefault();
  void shutdown().finally(() => app.exit(0));
});

app.on('will-quit', () => {
  try {
    globalShortcut.unregisterAll();
  } catch {
    /* nothing to clean up */
  }
});

async function shutdown(): Promise<void> {
  await Promise.race([
    // Stop the runner children, the loopback server, AND the WS bridge (remote
    // clients). allSettled never rejects, so one failing doesn't skip the others.
    Promise.allSettled([
      pool?.stopAll() ?? Promise.resolve(),
      loopback?.close() ?? Promise.resolve(),
      wsServer?.close() ?? Promise.resolve(),
    ]),
    // Belt-and-braces timeout: don't hang the app on a stuck child.
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
  ]);
  wsServer = null;
}
