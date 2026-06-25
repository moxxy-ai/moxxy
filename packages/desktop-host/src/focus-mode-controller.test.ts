import { describe, expect, it, vi } from 'vitest';
import { createFocusModeController } from './focus-mode-controller';

class FakeMainWindow {
  destroyed = false;
  minimized = false;
  fullScreen = false;
  delayLeaveFullScreen = false;
  readonly calls: string[] = [];
  private pendingLeaveFullScreen = false;
  private readonly leaveFullScreenListeners = new Set<() => void>();

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isMinimized(): boolean {
    return this.minimized;
  }

  isFullScreen(): boolean {
    return this.fullScreen;
  }

  hide(): void {
    this.calls.push('hide');
  }

  restore(): void {
    this.calls.push('restore');
    this.minimized = false;
  }

  show(): void {
    this.calls.push('show');
  }

  focus(): void {
    this.calls.push('focus');
  }

  setFullScreen(value: boolean): void {
    this.calls.push(`setFullScreen:${String(value)}`);
    if (!value && this.delayLeaveFullScreen) {
      this.pendingLeaveFullScreen = true;
      return;
    }
    this.fullScreen = value;
    if (!value) {
      this.emitLeaveFullScreen();
    }
  }

  once(event: 'leave-full-screen', listener: () => void): void {
    if (event === 'leave-full-screen') {
      this.leaveFullScreenListeners.add(listener);
    }
  }

  off(event: 'leave-full-screen', listener: () => void): void {
    if (event === 'leave-full-screen') {
      this.leaveFullScreenListeners.delete(listener);
    }
  }

  finishLeavingFullScreen(): void {
    if (!this.pendingLeaveFullScreen) return;
    this.pendingLeaveFullScreen = false;
    this.fullScreen = false;
    this.emitLeaveFullScreen();
  }

  private emitLeaveFullScreen(): void {
    const listeners = [...this.leaveFullScreenListeners];
    this.leaveFullScreenListeners.clear();
    for (const listener of listeners) listener();
  }
}

describe('FocusModeController', () => {
  it('opens focus mode by showing the widget before hiding the main window', async () => {
    const mainWindow = new FakeMainWindow();
    const calls: string[] = [];
    const controller = createFocusModeController({
      showFocus: vi.fn(async () => calls.push('showFocus')),
      closeFocus: vi.fn(() => calls.push('closeFocus')),
      isFocusOpen: vi.fn(() => false),
      getMainWindow: vi.fn(() => mainWindow),
    });

    await controller.toggle();

    expect(calls).toEqual(['showFocus']);
    expect(mainWindow.calls).toEqual(['hide']);
  });

  it('opens focus mode from a minimized main window without restoring it first', async () => {
    const mainWindow = new FakeMainWindow();
    mainWindow.minimized = true;
    const controller = createFocusModeController({
      showFocus: vi.fn(async () => undefined),
      closeFocus: vi.fn(),
      isFocusOpen: vi.fn(() => false),
      getMainWindow: vi.fn(() => mainWindow),
    });

    await controller.toggle();

    expect(mainWindow.calls).toEqual(['hide']);
  });

  it('closes focus mode and restores the main window when the widget is already open', async () => {
    const mainWindow = new FakeMainWindow();
    mainWindow.minimized = true;
    const calls: string[] = [];
    const focusApp = vi.fn(() => calls.push('focusApp'));
    const controller = createFocusModeController({
      showFocus: vi.fn(async () => calls.push('showFocus')),
      closeFocus: vi.fn(() => calls.push('closeFocus')),
      isFocusOpen: vi.fn(() => true),
      getMainWindow: vi.fn(() => mainWindow),
      focusApp,
    });

    await controller.toggle();

    expect(calls).toEqual(['closeFocus', 'focusApp']);
    expect(mainWindow.calls).toEqual(['restore', 'show', 'focus']);
  });

  it('allows entering focus mode while the main window is fullscreen and restores fullscreen later', async () => {
    const mainWindow = new FakeMainWindow();
    mainWindow.fullScreen = true;
    let focusOpen = false;
    const controller = createFocusModeController({
      showFocus: vi.fn(async () => {
        focusOpen = true;
      }),
      closeFocus: vi.fn(() => {
        focusOpen = false;
      }),
      isFocusOpen: vi.fn(() => focusOpen),
      getMainWindow: vi.fn(() => mainWindow),
    });

    await controller.toggle();
    expect(mainWindow.calls).toEqual(['setFullScreen:false', 'hide']);

    await controller.toggle();

    expect(mainWindow.calls).toEqual([
      'setFullScreen:false',
      'hide',
      'show',
      'setFullScreen:true',
      'focus',
    ]);
  });

  it('waits for macOS to leave native fullscreen before hiding the main window', async () => {
    const mainWindow = new FakeMainWindow();
    mainWindow.fullScreen = true;
    mainWindow.delayLeaveFullScreen = true;
    const controller = createFocusModeController({
      showFocus: vi.fn(async () => undefined),
      closeFocus: vi.fn(),
      isFocusOpen: vi.fn(() => false),
      getMainWindow: vi.fn(() => mainWindow),
    });

    const enter = controller.enterFocusMode();
    await Promise.resolve();
    await Promise.resolve();

    expect(mainWindow.calls).toEqual(['setFullScreen:false']);

    mainWindow.finishLeavingFullScreen();
    await enter;

    expect(mainWindow.calls).toEqual(['setFullScreen:false', 'hide']);
  });

  it('does not hide the main window when showing the focus widget fails', async () => {
    const mainWindow = new FakeMainWindow();
    const controller = createFocusModeController({
      showFocus: vi.fn(async () => {
        throw new Error('focus failed');
      }),
      closeFocus: vi.fn(),
      isFocusOpen: vi.fn(() => false),
      getMainWindow: vi.fn(() => mainWindow),
    });

    await expect(controller.toggle()).rejects.toThrow('focus failed');
    expect(mainWindow.calls).toEqual([]);
  });

  it('uses ensureMainWindow when restoring after the main window was destroyed', async () => {
    const destroyedWindow = new FakeMainWindow();
    destroyedWindow.destroyed = true;
    const recreatedWindow = new FakeMainWindow();
    const ensureMainWindow = vi.fn(async () => recreatedWindow);
    const controller = createFocusModeController({
      showFocus: vi.fn(async () => undefined),
      closeFocus: vi.fn(),
      isFocusOpen: vi.fn(() => true),
      getMainWindow: vi.fn(() => destroyedWindow),
      ensureMainWindow,
    });

    await controller.restoreMain();

    expect(ensureMainWindow).toHaveBeenCalledTimes(1);
    expect(destroyedWindow.calls).toEqual([]);
    expect(recreatedWindow.calls).toEqual(['show', 'focus']);
  });
});
