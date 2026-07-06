export interface FocusModeMainWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  hide(): void;
  restore(): void;
  show(): void;
  focus(): void;
  isFullScreen?(): boolean;
  setFullScreen?(value: boolean): void;
  once?(event: 'leave-full-screen', listener: () => void): void;
  off?(event: 'leave-full-screen', listener: () => void): void;
}

export interface FocusModeControllerDeps {
  readonly showFocus: () => Promise<void> | void;
  readonly closeFocus: () => Promise<void> | void;
  readonly isFocusOpen: () => boolean;
  readonly getMainWindow: () => FocusModeMainWindow | null;
  readonly ensureMainWindow?: () => Promise<FocusModeMainWindow | null> | FocusModeMainWindow | null;
  readonly focusApp?: () => void;
}

export interface FocusModeController {
  readonly toggle: () => Promise<void>;
  readonly enterFocusMode: () => Promise<void>;
  readonly restoreMain: () => Promise<void>;
}

function usable(window: FocusModeMainWindow | null): window is FocusModeMainWindow {
  return !!window && !window.isDestroyed();
}

const LEAVE_FULL_SCREEN_TIMEOUT_MS = 1200;

function waitForLeaveFullScreen(window: FocusModeMainWindow): Promise<void> {
  const onceLeaveFullScreen = window.once?.bind(window);
  const offLeaveFullScreen = window.off?.bind(window);
  if (!onceLeaveFullScreen) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      offLeaveFullScreen?.('leave-full-screen', finish);
      resolve();
    };

    onceLeaveFullScreen('leave-full-screen', finish);
    timeout = setTimeout(finish, LEAVE_FULL_SCREEN_TIMEOUT_MS);
  });
}

async function leaveFullScreenBeforeHide(window: FocusModeMainWindow): Promise<boolean> {
  if (!usable(window)) return false;
  if (window.isFullScreen?.() !== true) return true;
  if (typeof window.setFullScreen !== 'function') return false;

  const didLeaveFullScreen = waitForLeaveFullScreen(window);
  window.setFullScreen(false);
  await didLeaveFullScreen;

  if (!usable(window)) return false;
  return window.isFullScreen?.() !== true;
}

export function createFocusModeController(
  deps: FocusModeControllerDeps,
): FocusModeController {
  let restoreFullscreen = false;

  async function getOrEnsureMainWindow(): Promise<FocusModeMainWindow | null> {
    const current = deps.getMainWindow();
    if (usable(current)) return current;
    if (!deps.ensureMainWindow) return null;
    const ensured = await deps.ensureMainWindow();
    return usable(ensured) ? ensured : null;
  }

  async function enterFocusMode(): Promise<void> {
    const mainWindow = await getOrEnsureMainWindow();
    const wasFullscreen = mainWindow ? Boolean(mainWindow.isFullScreen?.()) : false;

    await deps.showFocus();
    restoreFullscreen = wasFullscreen;

    if (usable(mainWindow)) {
      const canHide = await leaveFullScreenBeforeHide(mainWindow);
      if (canHide && usable(mainWindow)) {
        mainWindow.hide();
      }
    }
  }

  async function restoreMain(): Promise<void> {
    await deps.closeFocus();
    const mainWindow = await getOrEnsureMainWindow();
    if (!mainWindow) return;

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    if (
      restoreFullscreen &&
      typeof mainWindow.setFullScreen === 'function' &&
      mainWindow.isFullScreen?.() === false
    ) {
      mainWindow.setFullScreen(true);
    }
    mainWindow.focus();
    deps.focusApp?.();
    restoreFullscreen = false;
  }

  async function toggle(): Promise<void> {
    if (deps.isFocusOpen()) {
      await restoreMain();
      return;
    }
    await enterFocusMode();
  }

  return { toggle, enterFocusMode, restoreMain };
}
