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
  cwdForSession,
  syncSessionIndexIntoRegistry,
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
  clerkAccountPortalHost,
  installAccountPortalRecovery,
  preferredCliEntry,
  ensureDesktopVaultKey,
  activateManagedNode,
  startLoopbackServer,
  installAppAssetProtocol,
  loadOrCreateSelfSignedCert,
  isTrustedLoopbackCert,
  isTrustedLoopbackCertByHost,
  sendEvent,
  readPrefs,
  updatePrefs,
  type LoopbackServer,
  type SelfSignedCert,
} from '@moxxy/desktop-host';
import type { DeepLinkPayload, MobileGatewayStatus } from '@moxxy/desktop-ipc-contract';
// Value imports of @moxxy/ipc-server-ws are lazy + guarded (see the bridge
// block below): the bridge is opt-in, and a top-level static import would make
// boot itself depend on the module resolving — the exact failure that bricked
// the 0.0.33 build when the package wasn't in BUNDLED_WORKSPACE_DEPS.
// Type-only imports are erased at build time and carry no such risk.
import type { WebSocketCommandBus, WebSocketBridgeServer } from '@moxxy/ipc-server-ws';

import { resolveWsBridgeConfig, MobileGatewayManager } from './ws-bridge.js';

import { BUNDLED_UPDATE_PUBLIC_KEY } from './update-key.js';
import { FLOOR_RUNNER_PROTOCOL } from './floor-runner-protocol.js';
import { readConfirmed, markConfirmed, markBad, appendBootLog } from '@moxxy/desktop-host/app-update';
import { initShellUpdater, installFullAppUpdate } from './shell-updater.js';
import { DeepLinkRouter } from './deep-link.js';
import { buildOAuthHostPatterns, cleanOAuthUserAgent } from './oauth-window.js';
import { makeCertVerifyProc, makeCertificateErrorHandler } from './loopback-tls.js';
import { armBootProbe } from './boot-probe.js';
import { installApplicationMenu } from './menus.js';
import { registerAppAssetSchemePrivileged } from './app-scheme.js';

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
import { ipcMain, Tray, Menu, nativeImage, nativeTheme, globalShortcut, session, shell, systemPreferences } from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The local-only `moxxy-app://` asset scheme (serves an installed app's
// downloaded assets — e.g. the anonymizer's NER model — from `userData/moxxy-apps`
// over a confined GET/HEAD handler with no network egress) is registered as
// privileged by the immutable bootstrap, which is the only code guaranteed to
// run BEFORE `app` is ready (Electron only honors registerSchemesAsPrivileged
// pre-ready). This module is loaded by the bootstrap via `import()` AFTER ready,
// so a top-level registration here would throw and crash the override on load —
// see ./app-scheme. This call is a defensive no-op in the normal (bootstrap)
// path; it only does anything if `index.ts` is ever the direct pre-ready entry.
registerAppAssetSchemePrivileged();

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
/** Runtime controller for the mobile gateway (Settings → Mobile). Owns the
 *  start/stop/status/rotate lifecycle once the WS bus + module are loaded. */
let mobileGateway: MobileGatewayManager | null = null;

// In-app loopback HTTPS server the packaged renderer is served from at
// `https://desktop.moxxy.ai:<port>` (so the Clerk web SDK runs on a moxxy.ai
// subdomain origin — required by a `pk_live_` production key, which is
// domain-locked and rejects a bare loopback IP origin). null in dev (Vite
// serves it) and when every candidate port was taken (we fall back to file://).
let loopback: LoopbackServer | null = null;
// The self-signed cert backing that HTTPS server. Held so the
// `certificate-error` handler can scope-trust it by fingerprint.
let loopbackCert: SelfSignedCert | null = null;
// Fixed, stable loopback ports — each MUST be allow-listed in the Clerk
// dashboard (origins are exact-match including the port), and the
// `certificate-error` trust is scoped to exactly these ports on
// desktop.moxxy.ai.
const LOOPBACK_PORTS = [51789, 51790, 51791, 51792] as const;

// ---- moxxy:// deep-link transport -----------------------------------------

/** Bring the main window to the foreground (deep-link / second-instance). */
function focusMain(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (process.platform === 'darwin') app.focus({ steal: true });
}

// The deep-link transport (URL parsing + cold-start buffering) lives in
// ./deep-link; it reads the current window + focuses it through these injected
// accessors so it stays decoupled from the `mainWindow` singleton.
const deepLinks = new DeepLinkRouter(() => mainWindow, focusMain);

async function createWindow(): Promise<void> {
  // The renderer is served either from Vite's dev server or from the
  // packaged dist/. The window icon needs a filesystem path though
  // (Electron doesn't accept http:// urls for `icon`), so we resolve
  // it relative to the built dist/ in prod and the renderer source
  // in dev.
  const iconPath = isDev
    ? path.join(__dirname, '..', '..', '..', 'public', 'logo.png')
    : path.join(__dirname, '..', '..', 'dist', 'logo.png');

  // Hosts where Clerk's OAuth popup is allowed to open (static set + the
  // `pk_live_` instance's own Frontend API host + parent-domain wildcard).
  // Anything else returns `action: 'deny'` so we don't accidentally let
  // arbitrary window.open() calls spawn full Electron windows.
  const OAUTH_HOST_PATTERNS = buildOAuthHostPatterns(CLERK_PUBLISHABLE_KEY);

  mainWindow = new BrowserWindow({
    title: 'MoxxyAI Workspaces',
    width: 1180,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    // Match the themed app canvas (--color-app-bg light/dark) so the window
    // doesn't flash white-then-dark while the renderer boots. themeSource was
    // set from prefs before createWindow, so shouldUseDarkColors is correct
    // for explicit choices as well as `system`.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0c13' : '#f1f2f9',
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

  // Refuse top-frame navigation away from our own origin — EXCEPT to the
  // OAuth hosts. clerk-js's prebuilt sign-in buttons run the provider flow
  // as a top-frame redirect (not a popup), so the frame must be allowed to
  // round-trip app → accounts.google.com → clerk FAPI → back here. The
  // return leg lands on a loopback serving origin that differs from the
  // page's CURRENT origin mid-flow, so those origins are allow-listed
  // explicitly (dev: the Vite origin).
  const appOriginPatterns = [
    new RegExp(`^https://desktop\\.moxxy\\.ai:(?:${LOOPBACK_PORTS.join('|')})$`),
    ...(isDev ? [/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/] : []),
  ];
  lockDownNavigation(mainWindow, {
    keepWindowOpenHandler: true,
    allowOriginPatterns: [...OAUTH_HOST_PATTERNS, ...appOriginPatterns],
  });

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
    deepLinks.markLoading();
  });

  // Recovery net for the OAuth return leg: when Clerk's FAPI loses the
  // redirect_url mid-flow it falls back to the hosted Account Portal
  // (accounts.<domain>) — a host the lockdown's parent-domain wildcard
  // legitimately allows for the FAPI round-trip — stranding the window on
  // "My account" instead of back in the app. Detect that landing and load
  // the app root again (the session cookie is already set, so the user
  // arrives signed in). Recovery only; the allow-list above is unchanged.
  const appRootUrl = isDev
    ? process.env['ELECTRON_RENDERER_URL']
    : loopback?.url('index.html');
  if (appRootUrl) {
    installAccountPortalRecovery(mainWindow, {
      portalHost: clerkAccountPortalHost(CLERK_PUBLISHABLE_KEY),
      appUrl: appRootUrl,
    });
  }

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

let trayInstance: Tray | null = null;

// installApplicationMenu lives in ./menus; armBootProbe lives in ./boot-probe
// (with its persistence + relaunch deps injected so the state machine is
// unit-testable). Both are imported at the top.

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
    deepLinks.handle(url);
  });
  // Windows/Linux: a link opened while running relaunches with the URL in
  // argv, delivered here to the primary instance.
  app.on('second-instance', (_event, argv) => {
    focusMain();
    const url = argv.find((a) => a.startsWith('moxxy://'));
    if (url) deepLinks.handle(url);
  });
}

app.whenReady().then(async () => {
  // Losing instance of the single-instance lock — it already called
  // app.quit() above; do nothing here so it exits cleanly.
  if (!gotSingleInstanceLock) return;

  // Apply the persisted theme preference BEFORE any window exists so the
  // very first paint (splash background, window chrome, the renderer's
  // prefers-color-scheme media query) already reflects it. `system` is the
  // default and means "follow the OS". The prefs.update IPC handler keeps
  // themeSource in sync afterwards; readPrefs is sync, so no boot race.
  // Guarded because prefs.json is user-editable and Electron throws on an
  // unknown themeSource value — a hand-mangled pref must not brick boot.
  const themePref = readPrefs().theme;
  nativeTheme.themeSource =
    themePref === 'light' || themePref === 'dark' ? themePref : 'system';

  // Present a plain desktop-Chrome user-agent (no Electron/app product
  // tokens) to every request. Google blocks OAuth from "embedded"
  // user-agents ("this browser may not be secure"); a clean UA lets the
  // in-app sign-in popup through. Set before any window so the very first
  // request carries it. Harmless for our own + Clerk requests.
  app.userAgentFallback = cleanOAuthUserAgent(app.userAgentFallback, app.getName());

  // Serve the packaged renderer over an HTTPS loopback origin at
  // `https://desktop.moxxy.ai:<port>` — a Chromium secure context AND, crucially,
  // a moxxy.ai subdomain origin, which a Clerk PRODUCTION key (`pk_live_`)
  // requires (it's domain-locked and rejects a bare 127.0.0.1 origin). The
  // hostname is a public DNS A-record → 127.0.0.1, so traffic never leaves the
  // box; the self-signed cert is scope-trusted below (NOT system-wide). Dev
  // keeps Vite; if every candidate port is taken (or the cert can't be minted)
  // we fall back to file:// (sign-in degrades but the app still boots).
  if (!isDev) {
    try {
      loopbackCert = await loadOrCreateSelfSignedCert(app.getPath('userData'));
      loopback = await startLoopbackServer({
        root: path.join(__dirname, '..', '..', 'dist'),
        ports: [...LOOPBACK_PORTS],
        tls: { cert: loopbackCert.cert, key: loopbackCert.key },
      });
      console.log(`[moxxy] renderer served at ${loopback.origin}`);
    } catch (err) {
      console.error('[moxxy] loopback server failed; falling back to file://', err);
      loopback = null;
      loopbackCert = null;
    }
  }

  // Scope-trust the loopback server's self-signed cert — ONLY for our fixed
  // host (`desktop.moxxy.ai`) AND only when the presented cert's fingerprint
  // matches the one we minted. This is NOT a blanket `ignore-certificate-errors`:
  // every other host/cert falls through to Chromium's own verification.
  //
  // The CANONICAL mechanism is `session.setCertificateVerifyProc` on the
  // session the window uses — `app.on('certificate-error')` is unreliable for
  // loopback HTTPS under Electron's network-service process (it does not fire
  // for the main-frame + subresource loads here, so the renderer would white-
  // screen with `ERR_CERT_AUTHORITY_INVALID` / net_error -202). The verify-proc
  // is installed on the default session BEFORE the window loads the URL (this
  // block runs ahead of createWindow()), and `loopbackCert` is already assigned
  // above, so there is no null-at-fire-time race.
  // The scoped-trust hooks (host + port + fingerprint) live in ./loopback-tls;
  // they read `loopbackCert` through the accessor so there is no
  // null-at-fire-time race (it is assigned above, before the window loads).
  session.defaultSession.setCertificateVerifyProc(makeCertVerifyProc(() => loopbackCert));

  // Belt-and-braces: keep the `certificate-error` handler too. It rarely fires
  // for the loopback load (see above) but costs nothing and covers any path the
  // verify-proc doesn't, with the identical scoped trust (host + port +
  // fingerprint). Everything else gets normal verification.
  app.on('certificate-error', makeCertificateErrorHandler(() => loopbackCert, LOOPBACK_PORTS));

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

  // Serve installed app assets (the anonymizer's NER model) over the confined,
  // local-only `moxxy-app://` scheme registered privileged above. Rooted at
  // `userData/moxxy-apps`; the installer creates that dir lazily on first
  // install, and the handler 404s harmlessly until then. No network egress —
  // it only reads files under that root (realpath-contained, GET/HEAD only).
  installAppAssetProtocol(path.join(app.getPath('userData'), 'moxxy-apps'));

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
  await syncSessionIndexIntoRegistry().catch(() => undefined);
  const desks = new DeskStore();
  // Prime: spawn a runner for the active workspace if one is bound,
  // otherwise an unbound runner so the user lands in a working chat
  // surface from the first paint.
  const initialActive = await desks.getActive();
  if (initialActive?.activeSessionId) {
    // The pool is keyed by SESSION id — prime the desk's active session
    // (for a pre-multi-session desk this is the desk id itself, so the
    // sticky runner log it resumes is unchanged).
    await pool.getOrCreate(
      initialActive.activeSessionId,
      cwdForSession(initialActive, initialActive.activeSessionId),
    );
    pool.setActive(initialActive.activeSessionId);
  } else {
    await pool.getOrCreate(UNBOUND_ID, null);
    pool.setActive(UNBOUND_ID);
  }
  // The Electron transport is always present. The WebSocket bridge (remote
  // clients / the mobile app) is now controllable at RUNTIME from Settings →
  // Mobile (the "mobile gateway"), so the bus + module are loaded unconditionally
  // here — but the SERVER stays off until the user enables it (or the env-gated
  // boot path / persisted preference asks for it). Register handlers onto the WS
  // bus BEFORE any server starts accepting, so an early client connection sees a
  // populated bus. The bridge module is lazy-imported and fully guarded (the
  // shell-updater pattern): a module that fails to load degrades to "gateway
  // unavailable", never takes down the app.
  const electronBus = new ElectronCommandBus();
  const userData = app.getPath('userData');
  const wsConfig = resolveWsBridgeConfig(userData); // non-null only when MOXXY_WS_BRIDGE=1
  let wsBridge: typeof import('@moxxy/ipc-server-ws') | null = null;
  try {
    wsBridge = await import('@moxxy/ipc-server-ws');
  } catch (e) {
    console.error('[moxxy] WebSocket bridge unavailable (module failed to load):', e);
  }
  const wsBus: WebSocketCommandBus | null = wsBridge ? new wsBridge.WebSocketCommandBus() : null;

  // The runtime gateway controller. It owns the server lifecycle (start/stop/
  // status/rotate); the Settings → Mobile IPC commands delegate to it. Status
  // changes fan out to the renderer via the `mobileGateway.changed` event.
  if (wsBridge && wsBus) {
    mobileGateway = new MobileGatewayManager({
      wsBridge,
      wsBus,
      userDataDir: userData,
      readEnabledPref: () => readPrefs().mobileGatewayEnabled,
      writeEnabledPref: async (enabled) => {
        await updatePrefs({ mobileGatewayEnabled: enabled });
      },
      onChange: (status: MobileGatewayStatus) => {
        if (mainWindow) sendEvent(mainWindow, 'mobileGateway.changed', status);
      },
    });
  }

  registerIpcHandlers(wsBus ? [electronBus, wsBus] : [electronBus], pool, desks, {
    update: {
      publicKeyPem: BUNDLED_UPDATE_PUBLIC_KEY,
      // Dev/test escape hatch: point the updater at a local manifest. Ignored in
      // packaged builds (the handler pins the source) so it can't be abused.
      manifestUrl: process.env.MOXXY_UPDATE_URL,
      // The same runner-protocol ceiling the bootstrap's boot gate enforces, so
      // the stager refuses (with a "needs the full installer" status) a bundle
      // that every boot would silently reject as `runner-protocol-skew`. When
      // this main IS a hot-updated override, its compiled constant can only be
      // ≤ the floor's (the boot gate already admitted it) — i.e. at worst the
      // stage-time gate is conservative, never permissive.
      cliRunnerProtocol: FLOOR_RUNNER_PROTOCOL,
      // Tier-2: lets `app.updateShell` download + install the full installer
      // when a release can't ship as a hot-update (runner bump). Lives here —
      // not in desktop-host — because this app owns the electron-updater dep.
      installShellUpdate: installFullAppUpdate,
    },
    // Bridge-control commands (host-only; refused over the WS transport).
    ...(mobileGateway ? { mobileGateway } : {}),
  });

  // Events fan out to WS clients once the bus exists — independent of whether the
  // server is up yet, so a client that connects later still gets the live stream.
  if (wsBus) wsEventBus.addSink(wsBus);

  if (wsBridge && wsBus && wsConfig && mobileGateway) {
    // Back-compat env-gated boot path: start the bridge once and hand the running
    // server to the runtime controller so status/rotate/stop see it too.
    try {
      wsServer = await wsBridge.startWsBridge(wsBus, wsConfig);
      const host = wsConfig.host ?? '127.0.0.1';
      const m = /:(\d+)$/.exec(wsServer.address);
      mobileGateway.adopt(wsServer, host, m ? Number(m[1]) : wsConfig.port);
      console.log(`[moxxy] WebSocket bridge listening on ${wsServer.address}`);
    } catch (e) {
      console.error('[moxxy] WebSocket bridge failed to start:', e);
    }
  } else if (mobileGateway) {
    // No env override: re-start the gateway iff the user previously enabled it
    // (persisted preference), so pairing survives a restart.
    await mobileGateway.resume();
    wsServer = mobileGateway.liveServer;
  }

  // The renderer's DeepLinkBridge calls this once on mount: it returns +
  // clears any `moxxy://` links buffered before the renderer was listening
  // (cold-start), and flips the ready flag so subsequent links push live.
  // Because the bridge subscribes to `deepLink:received` BEFORE invoking this
  // (one synchronous effect), no link can slip through between the two.
  ipcMain.removeHandler('deepLink:drain');
  ipcMain.handle('deepLink:drain', (): DeepLinkPayload[] => deepLinks.drain());

  await createWindow();
  if (mainWindow) {
    armBootProbe(mainWindow, {
      version: process.env.MOXXY_APP_BUNDLE_VERSION,
      userData: app.getPath('userData'),
      shell: { electron: process.versions.electron, nodeAbi: process.versions.modules ?? '' },
      readConfirmed,
      markConfirmed,
      markBad,
      appendBootLog,
      relaunch: () => app.relaunch(),
      quit: () => app.quit(),
    });
  }

  // Cold-start deep-link: Windows/Linux pass a `moxxy://` URL as an argv
  // token (macOS uses open-url, already buffered above). Buffer it for the
  // renderer's first drain.
  const argvUrl = process.argv.find((a) => a.startsWith('moxxy://'));
  if (argvUrl) deepLinks.handle(argvUrl);

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
  // The runtime gateway may have replaced `wsServer` (toggled on/off from
  // Settings), so close whichever server is currently live, preferring the
  // controller's view.
  const liveBridge = mobileGateway?.liveServer ?? wsServer;
  await Promise.race([
    // Stop the runner children, the loopback server, AND the WS bridge (remote
    // clients). allSettled never rejects, so one failing doesn't skip the others.
    Promise.allSettled([
      pool?.stopAll() ?? Promise.resolve(),
      loopback?.close() ?? Promise.resolve(),
      liveBridge?.close() ?? Promise.resolve(),
    ]),
    // Belt-and-braces timeout: don't hang the app on a stuck child.
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
  ]);
  wsServer = null;
}
