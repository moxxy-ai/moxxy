/**
 * Focus mode — frameless, transparent, always-on-top mini window
 * that floats over other apps. Same renderer bundle as the main app
 * but with the URL hash `#focus`; main.tsx reads the hash and mounts
 * <FocusWidget/> instead of <App/>.
 *
 * It's not a real Apple Live Activity (those are iOS only) — for an
 * Electron app on macOS this is the canonical pattern: a small
 * vibrant window pinned to a screen corner that hosts a status read-
 * out plus the next-action affordances (input + mic).
 */

import { BrowserWindow, app, screen } from 'electron';
import path from 'node:path';

let focusWindow: BrowserWindow | null = null;

interface CreateOpts {
  readonly devUrl?: string;
  readonly preloadPath: string;
  readonly indexHtml: string;
  /** Called the moment the focus window is created so the caller
   *  can wire IPC event forwarding (runner.event, turn.complete,
   *  connection.changed) into the secondary surface. Returns an
   *  unbind fn that runs when the window closes. */
  readonly attach?: (win: BrowserWindow) => () => void;
}

export function isFocusOpen(): boolean {
  return !!focusWindow && !focusWindow.isDestroyed();
}

/** Toggle the focus widget. Called from the tray menu / shortcut /
 *  main-window minimize handler. */
export async function toggleFocusWindow(opts: CreateOpts): Promise<void> {
  if (isFocusOpen()) {
    closeFocusWindow();
  } else {
    await showFocusWindow(opts);
  }
}

export function closeFocusWindow(): void {
  if (focusWindow && !focusWindow.isDestroyed()) {
    focusWindow.close();
    focusWindow = null;
  }
}

/** Spawn (or focus) the floating widget. Anchored to the bottom-
 *  right of the primary display by default; user-draggable while
 *  open. */
/** Pin the bottom-right corner so resizes feel anchored to the
 *  screen corner instead of sliding the window around. */
/** Resize the widget while keeping it visually anchored to its current
 *  spot. Anchor rule:
 *
 *    - If the widget sits in the bottom-right corner (within 80 px of
 *      the work-area edges) → pin its bottom-right corner. This is
 *      the default spawn position so collapses/expands snap nicely.
 *    - Otherwise → pin the widget's *centre*. Pinning a corner when
 *      the user has dragged the widget into the middle of the screen
 *      causes the jarring "it flew sideways" behaviour the user
 *      reported on expand / collapse. */
export function resizeFocusWindow(width: number, height: number): void {
  if (!focusWindow || focusWindow.isDestroyed()) return;
  const work = screen.getPrimaryDisplay().workArea;
  const margin = 24;
  const [prevW = 0, prevH = 0] = focusWindow.getSize();
  const [prevX = 0, prevY = 0] = focusWindow.getPosition();

  const inBottomRightZone =
    Math.abs(prevX + prevW - (work.x + work.width)) < 80 &&
    Math.abs(prevY + prevH - (work.y + work.height)) < 80;

  let nextX: number;
  let nextY: number;
  if (inBottomRightZone) {
    nextX = work.x + work.width - width - margin;
    nextY = work.y + work.height - height - margin;
  } else {
    // Pin the centre of the previous bounds to the centre of the new
    // bounds so the user's eyes follow the widget naturally.
    const cx = prevX + prevW / 2;
    const cy = prevY + prevH / 2;
    nextX = Math.round(cx - width / 2);
    nextY = Math.round(cy - height / 2);
  }

  // Clamp so we never end up off-screen after a resize.
  nextX = Math.max(work.x + 4, Math.min(nextX, work.x + work.width - width - 4));
  nextY = Math.max(work.y + 4, Math.min(nextY, work.y + work.height - height - 4));

  focusWindow.setBounds({ x: nextX, y: nextY, width, height }, true);
}

export async function showFocusWindow(opts: CreateOpts): Promise<void> {
  if (focusWindow && !focusWindow.isDestroyed()) {
    focusWindow.show();
    focusWindow.focus();
    return;
  }

  const work = screen.getPrimaryDisplay().workArea;
  // Start small — a 44×44 floating tile holding the logo. The
  // renderer's FocusWidget calls focus.resize when the user clicks
  // to expand to the menu (200×52) or the full panel (340×…).
  const width = 44;
  const height = 44;
  const margin = 24;
  const win = new BrowserWindow({
    title: 'MoxxyAI · Focus',
    width,
    height,
    x: work.x + work.width - width - margin,
    y: work.y + work.height - height - margin,
    minWidth: 40,
    minHeight: 40,
    maxWidth: 520,
    maxHeight: 320,
    frame: false,
    transparent: true,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    // Important: OS shadow + vibrancy fill the *window rect*, not
    // the CSS-rounded shape inside it. With the widget collapsed to
    // a 64×64 dot, that drew a visible rectangle around the circle.
    // We get a softer, shape-matching look from the CSS box-shadow /
    // backdrop-filter the renderer applies to each mode.
    hasShadow: false,
    webPreferences: {
      preload: opts.preloadPath,
      contextIsolation: true,
      sandbox: false,
    },
  });

  win.setAlwaysOnTop(true, 'floating', 1);
  // Visible across desktops + Spaces so the widget follows you when
  // you swipe to a different Space (macOS).
  if (typeof (win as unknown as { setVisibleOnAllWorkspaces?: (v: boolean, opts?: object) => void })
    .setVisibleOnAllWorkspaces === 'function') {
    (win as unknown as { setVisibleOnAllWorkspaces: (v: boolean, opts?: object) => void })
      .setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  focusWindow = win;
  const unbindAttach = opts.attach?.(win);
  win.on('closed', () => {
    unbindAttach?.();
    if (focusWindow === win) focusWindow = null;
  });

  // We load the same renderer bundle, just with a hash that flips
  // main.tsx into focus-mode.
  if (opts.devUrl) {
    await win.loadURL(`${opts.devUrl}#focus`);
  } else {
    await win.loadFile(opts.indexHtml, { hash: 'focus' });
  }
}

/** Bind main-window lifecycle events that should dismiss the focus
 *  widget. The widget itself is only summoned by an explicit hotkey
 *  / tray action — we deliberately do NOT pop it on minimize, hide,
 *  or full-screen, because macOS fires those for transient state
 *  changes (Space transitions, full-screen slides) and the user
 *  surprised by a mini widget every time is worse than the user
 *  having to press one key. */
export function bindMainWindowMinimize(
  mainWindow: BrowserWindow,
  _opts: CreateOpts,
): void {
  // If the user explicitly restores the main window, the widget is
  // redundant — drop it so we don't end up with both surfaces fighting
  // for the same input.
  mainWindow.on('restore', () => {
    closeFocusWindow();
  });
  mainWindow.on('focus', () => {
    closeFocusWindow();
  });
}

/** Send a payload to the focus widget if it's open. Used by the
 *  bridge to push status updates (active workspace, latest assistant
 *  text). */
export function sendToFocus<K extends string>(channel: K, payload: unknown): void {
  if (!focusWindow || focusWindow.isDestroyed()) return;
  if (focusWindow.webContents.isDestroyed()) return;
  focusWindow.webContents.send(channel, payload);
}

/** Quit helper for the tray menu. */
export function quit(): void {
  app.quit();
}
