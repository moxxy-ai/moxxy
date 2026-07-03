import { afterEach, describe, expect, it, vi } from 'vitest';

describe('focus-window', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doUnmock('electron');
    vi.doUnmock('./security');
  });

  it('starts the collapsed widget at visual tile size and shapes the native window', async () => {
    const createdOptions: Array<Record<string, unknown>> = [];
    const fakeWindow = {
      isDestroyed: () => false,
      show: vi.fn(),
      focus: vi.fn(),
      close: vi.fn(),
      destroy: vi.fn(),
      loadURL: vi.fn(() => Promise.resolve()),
      loadFile: vi.fn(() => Promise.resolve()),
      on: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn(),
      setShape: vi.fn(),
      invalidateShadow: vi.fn(),
    };

    vi.doMock('electron', () => ({
      BrowserWindow: vi.fn((options: Record<string, unknown>) => {
        createdOptions.push(options);
        return fakeWindow;
      }),
      screen: {
        getPrimaryDisplay: () => ({
          workArea: { x: 0, y: 0, width: 1000, height: 800 },
        }),
        getDisplayMatching: () => ({
          workArea: { x: 0, y: 0, width: 1000, height: 800 },
        }),
      },
    }));
    vi.doMock('./security', () => ({
      lockDownNavigation: vi.fn(),
    }));

    const { showFocusWindow } = await import('./focus-window');

    await showFocusWindow({
      devUrl: 'http://127.0.0.1:5173',
      preloadPath: '/tmp/preload.js',
      indexHtml: '/tmp/index.html',
      focusHtml: '/tmp/focus.html',
    });

    expect(createdOptions[0]).toMatchObject({
      width: 44,
      height: 44,
      maxWidth: 1600,
      maxHeight: 1600,
      show: false,
      type: process.platform === 'darwin' ? 'panel' : undefined,
    });
    expect(fakeWindow.setShape).toHaveBeenCalledOnce();
    const shape = fakeWindow.setShape.mock.calls[0]?.[0] as Array<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
    expect(shape.length).toBe(44);
    expect(shape[0]?.x).toBeGreaterThan(0);
    expect(shape.some((rect) => rect.x === 0 && rect.width === 44)).toBe(true);
    expect(fakeWindow.invalidateShadow).toHaveBeenCalledOnce();
  });

  it('reapplies macOS Spaces visibility after the focus document loads before showing the tile', async () => {
    const fakeWindow = {
      isDestroyed: () => false,
      show: vi.fn(),
      focus: vi.fn(),
      close: vi.fn(),
      destroy: vi.fn(),
      loadURL: vi.fn(() => Promise.resolve()),
      loadFile: vi.fn(() => Promise.resolve()),
      on: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn(),
      setShape: vi.fn(),
      invalidateShadow: vi.fn(),
      getBounds: vi.fn(() => ({ x: 932, y: 732, width: 44, height: 44 })),
    };

    vi.doMock('electron', () => ({
      BrowserWindow: vi.fn(() => fakeWindow),
      screen: {
        getPrimaryDisplay: () => ({
          workArea: { x: 0, y: 0, width: 1000, height: 800 },
        }),
        getDisplayMatching: () => ({
          workArea: { x: 0, y: 0, width: 1000, height: 800 },
        }),
      },
    }));
    vi.doMock('./security', () => ({
      lockDownNavigation: vi.fn(),
    }));

    const { showFocusWindow } = await import('./focus-window');

    await showFocusWindow({
      devUrl: 'http://127.0.0.1:5173',
      preloadPath: '/tmp/preload.js',
      indexHtml: '/tmp/index.html',
      focusHtml: '/tmp/focus.html',
    });

    expect(fakeWindow.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {
      visibleOnFullScreen: true,
    });
    expect(fakeWindow.setVisibleOnAllWorkspaces).toHaveBeenCalledTimes(3);
    expect(fakeWindow.setAlwaysOnTop).toHaveBeenCalledTimes(3);
    expect(fakeWindow.show).toHaveBeenCalledOnce();
    expect(fakeWindow.focus).toHaveBeenCalledOnce();

    const loadOrder = fakeWindow.loadURL.mock.invocationCallOrder[0];
    const showOrder = fakeWindow.show.mock.invocationCallOrder[0];
    const focusOrder = fakeWindow.focus.mock.invocationCallOrder[0];
    const visibilityOrders = fakeWindow.setVisibleOnAllWorkspaces.mock.invocationCallOrder;

    expect(visibilityOrders[0]).toBeLessThan(loadOrder);
    expect(loadOrder).toBeLessThan(visibilityOrders[1]);
    expect(visibilityOrders[1]).toBeLessThan(showOrder);
    expect(showOrder).toBeLessThan(focusOrder);
    expect(focusOrder).toBeLessThan(visibilityOrders[2]);
  });

  it('reapplies macOS Spaces visibility when showing an existing focus window', async () => {
    const fakeWindow = {
      isDestroyed: () => false,
      show: vi.fn(),
      focus: vi.fn(),
      close: vi.fn(),
      destroy: vi.fn(),
      loadURL: vi.fn(() => Promise.resolve()),
      loadFile: vi.fn(() => Promise.resolve()),
      on: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn(),
      setShape: vi.fn(),
      invalidateShadow: vi.fn(),
      getBounds: vi.fn(() => ({ x: 932, y: 732, width: 44, height: 44 })),
    };

    vi.doMock('electron', () => ({
      BrowserWindow: vi.fn(() => fakeWindow),
      screen: {
        getPrimaryDisplay: () => ({
          workArea: { x: 0, y: 0, width: 1000, height: 800 },
        }),
        getDisplayMatching: () => ({
          workArea: { x: 0, y: 0, width: 1000, height: 800 },
        }),
      },
    }));
    vi.doMock('./security', () => ({
      lockDownNavigation: vi.fn(),
    }));

    const { showFocusWindow } = await import('./focus-window');
    const opts = {
      devUrl: 'http://127.0.0.1:5173',
      preloadPath: '/tmp/preload.js',
      indexHtml: '/tmp/index.html',
      focusHtml: '/tmp/focus.html',
    };

    await showFocusWindow(opts);
    fakeWindow.show.mockClear();
    fakeWindow.focus.mockClear();
    fakeWindow.setAlwaysOnTop.mockClear();
    fakeWindow.setVisibleOnAllWorkspaces.mockClear();

    await showFocusWindow(opts);

    expect(fakeWindow.setVisibleOnAllWorkspaces).toHaveBeenCalledTimes(2);
    expect(fakeWindow.setAlwaysOnTop).toHaveBeenCalledTimes(2);
    expect(fakeWindow.show).toHaveBeenCalledOnce();
    expect(fakeWindow.focus).toHaveBeenCalledOnce();

    const showOrder = fakeWindow.show.mock.invocationCallOrder[0];
    const focusOrder = fakeWindow.focus.mock.invocationCallOrder[0];
    const visibilityOrders = fakeWindow.setVisibleOnAllWorkspaces.mock.invocationCallOrder;

    expect(visibilityOrders[0]).toBeLessThan(showOrder);
    expect(showOrder).toBeLessThan(focusOrder);
    expect(focusOrder).toBeLessThan(visibilityOrders[1]);
  });

  it('tears down a focus window that fails to load so the next toggle can retry cleanly', async () => {
    const fakeWindow = {
      isDestroyed: () => false,
      show: vi.fn(),
      focus: vi.fn(),
      close: vi.fn(),
      destroy: vi.fn(),
      loadURL: vi.fn(() => Promise.reject(new Error('focus load failed'))),
      loadFile: vi.fn(() => Promise.resolve()),
      on: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn(),
      setShape: vi.fn(),
      invalidateShadow: vi.fn(),
      getBounds: vi.fn(() => ({ x: 932, y: 732, width: 44, height: 44 })),
    };

    vi.doMock('electron', () => ({
      BrowserWindow: vi.fn(() => fakeWindow),
      screen: {
        getPrimaryDisplay: () => ({
          workArea: { x: 0, y: 0, width: 1000, height: 800 },
        }),
        getDisplayMatching: () => ({
          workArea: { x: 0, y: 0, width: 1000, height: 800 },
        }),
      },
    }));
    vi.doMock('./security', () => ({
      lockDownNavigation: vi.fn(),
    }));

    const { isFocusOpen, showFocusWindow } = await import('./focus-window');

    await expect(
      showFocusWindow({
        devUrl: 'http://127.0.0.1:5173',
        preloadPath: '/tmp/preload.js',
        indexHtml: '/tmp/index.html',
        focusHtml: '/tmp/focus.html',
      }),
    ).rejects.toThrow('focus load failed');

    expect(fakeWindow.destroy).toHaveBeenCalledOnce();
    expect(fakeWindow.show).not.toHaveBeenCalled();
    expect(fakeWindow.focus).not.toHaveBeenCalled();
    expect(isFocusOpen()).toBe(false);
  });

  it('uses the current active pill position as the restore point after native dragging', async () => {
    let bounds = { x: 932, y: 732, width: 44, height: 44 };
    const fakeWindow = {
      isDestroyed: () => false,
      show: vi.fn(),
      focus: vi.fn(),
      close: vi.fn(),
      destroy: vi.fn(),
      loadURL: vi.fn(() => Promise.resolve()),
      loadFile: vi.fn(() => Promise.resolve()),
      on: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn(),
      setResizable: vi.fn(),
      setMinimumSize: vi.fn(),
      setShape: vi.fn(),
      invalidateShadow: vi.fn(),
      getBounds: vi.fn(() => bounds),
      setBounds: vi.fn((next: typeof bounds) => {
        bounds = next;
      }),
    };

    vi.doMock('electron', () => ({
      BrowserWindow: vi.fn(() => fakeWindow),
      screen: {
        getPrimaryDisplay: () => ({
          workArea: { x: 0, y: 0, width: 1000, height: 800 },
        }),
        getDisplayMatching: () => ({
          workArea: { x: 0, y: 0, width: 1000, height: 800 },
        }),
      },
    }));
    vi.doMock('./security', () => ({
      lockDownNavigation: vi.fn(),
    }));

    const { resizeFocusWindow, showFocusWindow } = await import('./focus-window');

    await showFocusWindow({
      devUrl: 'http://127.0.0.1:5173',
      preloadPath: '/tmp/preload.js',
      indexHtml: '/tmp/index.html',
      focusHtml: '/tmp/focus.html',
    });
    resizeFocusWindow(232, 56);

    bounds = { x: 500, y: 100, width: 232, height: 56 };
    resizeFocusWindow(380, 440, true);
    resizeFocusWindow(232, 56);

    expect(bounds).toEqual({ x: 500, y: 100, width: 232, height: 56 });
    expect(fakeWindow.setMinimumSize).toHaveBeenNthCalledWith(2, 320, 260);
    expect(fakeWindow.setMinimumSize).toHaveBeenLastCalledWith(40, 40);
  });
});
