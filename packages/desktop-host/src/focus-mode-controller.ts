export interface FocusModeMainWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  hide(): void;
  restore(): void;
  show(): void;
  focus(): void;
  isFullScreen?(): boolean;
  setFullScreen?(value: boolean): void;
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
    const wasFullscreen = Boolean(mainWindow?.isFullScreen?.());

    await deps.showFocus();
    restoreFullscreen = wasFullscreen;

    if (usable(mainWindow)) {
      mainWindow.hide();
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
