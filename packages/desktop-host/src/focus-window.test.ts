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
  });
});
