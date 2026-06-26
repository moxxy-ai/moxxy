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

import { BrowserWindow, screen } from 'electron';
import { lockDownNavigation } from './security';
import {
  moveFocusBounds,
  moveFocusBoundsFromPointer,
  resizeFocusBounds,
  type FocusBounds,
  type FocusDragStart,
  type FocusHorizontalAnchor,
  type FocusScreenPoint,
  type FocusWorkArea,
} from './focus-window-geometry';

let focusWindow: BrowserWindow | null = null;
let focusDragStart: FocusDragStart | null = null;
let focusTileBounds: FocusBounds | null = null;

const COLLAPSED_FOCUS_SIZE = 44;
const COLLAPSED_FOCUS_RADIUS = 16;
const COMPACT_FOCUS_MAX_HEIGHT = 56;

interface CreateOpts {
  readonly devUrl?: string;
  readonly preloadPath: string;
  readonly indexHtml: string;
  /** Path to the focus widget's dedicated HTML in the prod bundle.
   *  In dev it's served as ${devUrl}/focus.html instead. */
  readonly focusHtml: string;
  /** Origin of the in-app loopback server (`http://127.0.0.1:<port>`) when
   *  the prod renderer is served over http rather than file://. When set,
   *  the widget loads `${loopbackBase}/focus.html`; otherwise it falls back
   *  to loading `focusHtml` from disk. Absent in dev (devUrl wins). */
  readonly loopbackBase?: string;
  /** Called the moment the focus window is created so the caller
   *  can wire IPC event forwarding (runner.event, turn.complete,
   *  connection.changed) into the secondary surface. Returns an
   *  unbind fn that runs when the window closes. */
  readonly attach?: (win: BrowserWindow) => () => void;
}

export interface FocusWindowPlacement {
  readonly horizontalAnchor: FocusHorizontalAnchor;
}

interface FocusWindowShapeRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

type ShapeableBrowserWindow = BrowserWindow & {
  readonly setShape?: (rects: FocusWindowShapeRect[]) => void;
  readonly invalidateShadow?: () => void;
};

export function roundedRectWindowShape(
  width: number,
  height: number,
  radius: number,
): FocusWindowShapeRect[] {
  const clampedRadius = Math.max(0, Math.min(radius, Math.floor(Math.min(width, height) / 2)));
  const rects: FocusWindowShapeRect[] = [];

  for (let y = 0; y < height; y += 1) {
    const inTopCorner = y < clampedRadius;
    const inBottomCorner = y >= height - clampedRadius;
    let inset = 0;

    if (inTopCorner || inBottomCorner) {
      const centerY = inTopCorner ? clampedRadius - 0.5 : height - clampedRadius - 0.5;
      const dy = Math.abs(y + 0.5 - centerY);
      inset = Math.ceil(clampedRadius - Math.sqrt(Math.max(0, clampedRadius ** 2 - dy ** 2)));
    }

    rects.push({
      x: inset,
      y,
      width: Math.max(0, width - inset * 2),
      height: 1,
    });
  }

  return rects;
}

function applyFocusWindowShape(win: BrowserWindow, width: number, height: number, resizable: boolean): void {
  const shapeable = win as ShapeableBrowserWindow;
  if (typeof shapeable.setShape !== 'function') return;

  if (resizable || width !== COLLAPSED_FOCUS_SIZE || height !== COLLAPSED_FOCUS_SIZE) {
    shapeable.setShape([]);
    shapeable.invalidateShadow?.();
    return;
  }

  shapeable.setShape(roundedRectWindowShape(width, height, COLLAPSED_FOCUS_RADIUS));
  shapeable.invalidateShadow?.();
}

function isCompactFocusSize(bounds: Pick<FocusBounds, 'width' | 'height'>): boolean {
  return bounds.height <= COMPACT_FOCUS_MAX_HEIGHT;
}

function rememberCompactFocusTileBounds(bounds: FocusBounds, workArea: FocusWorkArea): void {
  if (!isCompactFocusSize(bounds)) return;
  focusTileBounds = resizeFocusBounds({
    current: bounds,
    nextSize: {
      width: COLLAPSED_FOCUS_SIZE,
      height: COLLAPSED_FOCUS_SIZE,
    },
    workArea,
  }).bounds;
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
  focusDragStart = null;
  focusTileBounds = null;
}

/** Spawn (or focus) the floating widget. Anchored to the bottom-
 *  right of the primary display by default; user-draggable while
 *  open. */
/** Pin the bottom-right corner so resizes feel anchored to the
 *  screen corner instead of sliding the window around. */
/** Resize the widget — anchor to whichever screen edge is closer.
 *
 *  Rationale: a small floating icon naturally lives against one
 *  edge of the work area, not in the middle. Compute which side
 *  (left or right) the widget's centre currently sits closer to,
 *  then pin THAT edge so collapsing retreats outward and expanding
 *  grows inward. Same logic both directions, symmetric.
 *
 *  - Widget centre on left half  → pin LEFT edge.
 *  - Widget centre on right half → pin RIGHT edge.
 *
 *  Y axis: just keep the previous centre Y so the widget doesn't
 *  jump vertically when its height changes.
 */
export function resizeFocusWindow(
  width: number,
  height: number,
  resizable = false,
): FocusWindowPlacement | null {
  if (!focusWindow || focusWindow.isDestroyed()) return null;
  // Edge-resize grabs are only wanted for the mini-text panel; the small
  // inactive tile / active pill stay fixed. Toggle before setBounds so the
  // new size isn't clamped by a stale resizable state.
  focusWindow.setResizable(resizable);
  const current = focusWindow.getBounds() as FocusBounds;
  const workArea = screen.getDisplayMatching(current).workArea as FocusWorkArea;
  rememberCompactFocusTileBounds(current, workArea);
  const restoreBounds = isCompactFocusSize({ width, height }) ? focusTileBounds : null;
  const placement = resizeFocusBounds({
    current,
    nextSize: { width, height },
    restoreBounds,
    workArea,
  });

  // animate: false → snap, no overshoot.
  focusWindow.setBounds(placement.bounds, false);
  applyFocusWindowShape(focusWindow, placement.bounds.width, placement.bounds.height, resizable);
  rememberCompactFocusTileBounds(placement.bounds, workArea);
  return { horizontalAnchor: placement.horizontalAnchor };
}

export function moveFocusWindowBy(dx: number, dy: number): FocusWindowPlacement | null {
  if (!focusWindow || focusWindow.isDestroyed()) return null;
  const current = focusWindow.getBounds() as FocusBounds;
  const workArea = screen.getDisplayMatching(current).workArea as FocusWorkArea;
  const placement = moveFocusBounds({
    current,
    delta: { dx, dy },
    workArea,
  });
  focusWindow.setBounds(placement.bounds, false);
  rememberCompactFocusTileBounds(placement.bounds, workArea);
  return { horizontalAnchor: placement.horizontalAnchor };
}

export function beginFocusWindowDrag(pointer: FocusScreenPoint): FocusWindowPlacement | null {
  if (!focusWindow || focusWindow.isDestroyed()) return null;
  const bounds = focusWindow.getBounds() as FocusBounds;
  const workArea = screen.getDisplayMatching(bounds).workArea as FocusWorkArea;
  rememberCompactFocusTileBounds(bounds, workArea);
  focusDragStart = { bounds, pointer };
  return {
    horizontalAnchor:
      bounds.x + bounds.width / 2 >= workArea.x + workArea.width / 2 ? 'right' : 'left',
  };
}

export function moveFocusWindowDrag(pointer: FocusScreenPoint): FocusWindowPlacement | null {
  if (!focusWindow || focusWindow.isDestroyed() || !focusDragStart) return null;
  const targetBounds = {
    ...focusDragStart.bounds,
    x: focusDragStart.bounds.x + (pointer.screenX - focusDragStart.pointer.screenX),
    y: focusDragStart.bounds.y + (pointer.screenY - focusDragStart.pointer.screenY),
  };
  const workArea = screen.getDisplayMatching(targetBounds).workArea as FocusWorkArea;
  const placement = moveFocusBoundsFromPointer({
    dragStart: focusDragStart,
    pointer,
    workArea,
  });
  focusWindow.setBounds(placement.bounds, false);
  rememberCompactFocusTileBounds(placement.bounds, workArea);
  return { horizontalAnchor: placement.horizontalAnchor };
}

export function endFocusWindowDrag(): void {
  focusDragStart = null;
}

export async function showFocusWindow(opts: CreateOpts): Promise<void> {
  if (focusWindow && !focusWindow.isDestroyed()) {
    focusWindow.show();
    focusWindow.focus();
    return;
  }

  const work = screen.getPrimaryDisplay().workArea;
  // Start small — a 44×44 floating tile holding the logo. The native
  // window is shaped to the same rounded rect so the white webContents
  // background cannot show through the tile's anti-aliased corners.
  // renderer's FocusWidget calls focus.resize when the user clicks
  // to expand to the menu (200×52) or the full panel (340×…).
  const width = COLLAPSED_FOCUS_SIZE;
  const height = COLLAPSED_FOCUS_SIZE;
  const margin = 24;
  const initialBounds = {
    x: work.x + work.width - width - margin,
    y: work.y + work.height - height - margin,
    width,
    height,
  };
  const win = new BrowserWindow({
    title: 'MoxxyAI · Focus',
    width,
    height,
    x: initialBounds.x,
    y: initialBounds.y,
    minWidth: 40,
    minHeight: 40,
    // Generous ceiling so the mini-text panel can be dragged bigger to
    // read a long answer. The inactive tile / active pill keep their
    // small canonical sizes via focus.resize.
    maxWidth: 800,
    maxHeight: 800,
    frame: false,
    transparent: true,
    // Starts fixed (the inactive tile). resizeFocusWindow toggles this
    // per stage — on for mini-text so the user can drag the edges, off
    // for the tile / pill. setBounds from focus.resize works either way.
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
      sandbox: true,
    },
  });

  // The focus widget never opens child windows and never navigates away
  // from its own document — lock both down (deny window.open too).
  lockDownNavigation(win, { keepWindowOpenHandler: false });

  win.setAlwaysOnTop(true, 'floating', 1);
  // Visible across desktops + Spaces so the widget follows you when
  // you swipe to a different Space (macOS).
  // `setVisibleOnAllWorkspaces` is a no-op on some platforms; keep the runtime
  // existence guard but rely on Electron's own types (no casts needed).
  if (typeof win.setVisibleOnAllWorkspaces === 'function') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  applyFocusWindowShape(win, width, height, false);

  focusWindow = win;
  focusTileBounds =
    typeof win.getBounds === 'function' ? (win.getBounds() as FocusBounds) : initialBounds;
  const unbindAttach = opts.attach?.(win);
  win.on('closed', () => {
    unbindAttach?.();
    if (focusWindow === win) focusWindow = null;
    focusDragStart = null;
    focusTileBounds = null;
  });

  // Load the *dedicated* focus.html entry. It has its own bundle, its
  // own React tree, and its own preload bridge — no shared
  // module side-effects with the main app. Prefer the loopback origin (so
  // it shares the same secure-context origin as the main window); fall back
  // to file:// only when no loopback server is running.
  //
  // A load can reject (dev server down, loopback server down, missing
  // focus.html). If we left `focusWindow` pointing at the created-but-unloaded
  // window, isFocusOpen() would report true and the next toggle would close()
  // a blank widget instead of re-summoning it. Tear it down on failure so the
  // widget can be cleanly re-opened.
  try {
    if (opts.devUrl) {
      await win.loadURL(`${opts.devUrl}/focus.html`);
    } else if (opts.loopbackBase) {
      await win.loadURL(`${opts.loopbackBase}/focus.html`);
    } else {
      await win.loadFile(opts.focusHtml);
    }
  } catch (e) {
    if (focusWindow === win) focusWindow = null;
    focusDragStart = null;
    if (!win.isDestroyed()) win.destroy();
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/** Bind main-window lifecycle events that should dismiss the focus
 *  widget. The widget itself is only summoned by an explicit hotkey
 *  / tray action — we deliberately do NOT pop it on minimize, hide,
 *  or full-screen, because macOS fires those for transient state
 *  changes (Space transitions, full-screen slides) and the user
 *  surprised by a mini widget every time is worse than the user
 *  having to press one key. */
export function bindMainWindowFocusDismissal(mainWindow: BrowserWindow): void {
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

export function bindMainWindowMinimize(
  mainWindow: BrowserWindow,
  _opts: CreateOpts,
): void {
  bindMainWindowFocusDismissal(mainWindow);
}
