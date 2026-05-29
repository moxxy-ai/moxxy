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
  /** Path to the focus widget's dedicated HTML in the prod bundle.
   *  In dev it's served as ${devUrl}/focus.html instead. */
  readonly focusHtml: string;
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
/** Resize the widget by ALWAYS pinning its right edge.
 *
 *  Rationale: the small "inactive" form factor is most useful when
 *  it sits against the right side of the screen. Collapsing the
 *  active panel should leave the icon there instead of stranding
 *  it in the middle of where the panel used to be. Pinning the
 *  right edge means: expand grows leftward, collapse retreats
 *  rightward — the user's eye stays on the right side of the work
 *  area where they last clicked the tray. */
export function resizeFocusWindow(width: number, height: number): void {
  if (!focusWindow || focusWindow.isDestroyed()) return;
  const work = screen.getPrimaryDisplay().workArea;
  const margin = 24;
  const [prevW = 0, prevH = 0] = focusWindow.getSize();
  const [prevX = 0, prevY = 0] = focusWindow.getPosition();

  // Right edge stays where it was; new X comes from "right edge
  // minus new width".
  const rightEdge = prevX + prevW;
  let nextX = rightEdge - width;
  let nextY = prevY + (prevH - height) / 2;
  // For the very first resize (window spawned at width 44/etc.) we
  // want to anchor flush with the work-area right edge.
  if (Math.abs(prevX + prevW - (work.x + work.width)) > 80) {
    // User has dragged us off the right edge — just pin centre Y
    // instead of bottom-right.
    nextY = prevY + (prevH - height) / 2;
  } else {
    nextX = work.x + work.width - width - margin;
    nextY = prevY + (prevH - height) / 2;
  }

  // Clamp so we never end up off-screen.
  nextX = Math.max(work.x + 4, Math.min(nextX, work.x + work.width - width - 4));
  nextY = Math.max(work.y + 4, Math.min(nextY, work.y + work.height - height - 4));

  // animate=false → no bounce / overshoot during the resize step.
  focusWindow.setBounds(
    { x: Math.round(nextX), y: Math.round(nextY), width, height },
    false,
  );
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
    // User asked for fixed dimensions per stage — no edge-resize
    // grabs. setBounds from focus.resize IPC still works.
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    // No OS shadow — the user asked for a flat square look.
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

  // Load the *dedicated* focus.html entry. It has its own bundle, its
  // own React tree, and its own preload bridge — no shared
  // module side-effects with the main app.
  if (opts.devUrl) {
    await win.loadURL(`${opts.devUrl}/focus.html`);
  } else {
    await win.loadFile(opts.focusHtml);
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
