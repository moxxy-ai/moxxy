import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { NativeBrowserSnapshot } from '@moxxy/desktop-ipc-contract';

import { BrowserPaneGateway } from './BrowserPaneGateway';

const snapshot: NativeBrowserSnapshot = {
  backend: 'native',
  workspaceId: 'ws-1',
  activeTabId: 'tab-1',
  visible: true,
  tabs: [
    {
      id: 'tab-1',
      title: 'Moxxy',
      url: 'https://moxxy.ai',
      loading: false,
      canGoBack: false,
      canGoForward: true,
      zoom: 1,
    },
    {
      id: 'tab-2',
      title: 'Docs',
      url: 'https://docs.moxxy.ai',
      loading: false,
      canGoBack: true,
      canGoForward: false,
      zoom: 1,
    },
  ],
};

afterEach(() => {
  cleanup();
  __setApiOverride(null);
});

describe('BrowserPaneGateway', () => {
  it('uses native tabs and navigation without opening the screenshot surface', async () => {
    const invoke = vi.fn(async (channel: string, args?: unknown) => {
      if (channel === 'nativeBrowser.status') return { backend: 'native', available: true };
      if (channel === 'nativeBrowser.open') return snapshot;
      if (channel === 'nativeBrowser.selectTab') {
        return { ...snapshot, activeTabId: (args as { tabId: string }).tabId };
      }
      if (channel === 'nativeBrowser.closeTab') return snapshot;
      return undefined;
    });
    __setApiOverride({
      invoke,
      subscribe: vi.fn(() => () => undefined),
    } as never);

    render(<BrowserPaneGateway workspaceId="ws-1" />);

    const docsTab = await screen.findByRole('tab', { name: /Docs/i });
    fireEvent.click(docsTab);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('nativeBrowser.selectTab', {
        workspaceId: 'ws-1',
        tabId: 'tab-2',
      }),
    );

    const address = screen.getByRole('textbox', { name: 'Address' });
    fireEvent.change(address, { target: { value: 'example.com' } });
    fireEvent.submit(address.closest('form') as HTMLFormElement);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('nativeBrowser.navigate', {
        workspaceId: 'ws-1',
        tabId: 'tab-2',
        url: 'https://example.com',
      }),
    );
    expect(invoke).not.toHaveBeenCalledWith('surface.open', expect.anything());
  });

  it('uses the existing Playwright pane when native startup selected the legacy backend', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'nativeBrowser.status') {
        return {
          backend: 'playwright',
          available: true,
          reason: 'rollback selected',
        };
      }
      if (channel === 'surface.open') {
        return {
          surfaceId: 'surface-1',
          snapshot: {
            type: 'frame',
            base64: 'AAAA',
            mime: 'image/jpeg',
            url: 'https://legacy.example',
          },
        };
      }
      return undefined;
    });
    __setApiOverride({
      invoke,
      subscribe: vi.fn(() => () => undefined),
    } as never);

    render(<BrowserPaneGateway workspaceId="ws-1" />);

    expect(await screen.findByAltText('https://legacy.example')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('surface.open', {
      workspaceId: 'ws-1',
      kind: 'browser',
    });
    expect(invoke).not.toHaveBeenCalledWith('nativeBrowser.open', expect.anything());
  });

  it('treats address-bar text as a search instead of an invalid hostname', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'nativeBrowser.status') return { backend: 'native', available: true };
      if (channel === 'nativeBrowser.open') return snapshot;
      return undefined;
    });
    __setApiOverride({
      invoke,
      subscribe: vi.fn(() => () => undefined),
    } as never);
    render(<BrowserPaneGateway workspaceId="ws-1" />);
    const address = await screen.findByRole('textbox', { name: 'Address' });

    fireEvent.change(address, {
      target: { value: 'native browser performance' },
    });
    fireEvent.submit(address.closest('form') as HTMLFormElement);

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('nativeBrowser.navigate', {
        workspaceId: 'ws-1',
        tabId: 'tab-1',
        url: 'https://www.google.com/search?q=native+browser+performance',
      }),
    );
  });

  it('does not silently switch to Playwright when the backend status probe fails', async () => {
    let statusAttempts = 0;
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'nativeBrowser.status') {
        statusAttempts += 1;
        if (statusAttempts === 1) throw new Error('IPC temporarily unavailable');
        return { backend: 'native', available: true };
      }
      if (channel === 'nativeBrowser.open') return snapshot;
      return undefined;
    });
    __setApiOverride({
      invoke,
      subscribe: vi.fn(() => () => undefined),
    } as never);

    render(<BrowserPaneGateway workspaceId="ws-1" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('IPC temporarily unavailable');
    expect(invoke).not.toHaveBeenCalledWith('surface.open', expect.anything());

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('tab', { name: /Moxxy/i })).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('nativeBrowser.open', {
      workspaceId: 'ws-1',
    });
    expect(invoke).not.toHaveBeenCalledWith('surface.open', expect.anything());
  });

  it('releases a capture that finishes after the pane changes workspace', async () => {
    const capture = deferred<{ mediaType: 'image/png'; base64: string }>();
    const invoke = vi.fn(async (channel: string, args?: unknown) => {
      if (channel === 'nativeBrowser.status') return { backend: 'native', available: true };
      if (channel === 'nativeBrowser.open') {
        const workspaceId = (args as { workspaceId: string }).workspaceId;
        return { ...snapshot, workspaceId };
      }
      if (channel === 'nativeBrowser.beginCapture') return capture.promise;
      return undefined;
    });
    __setApiOverride({
      invoke,
      subscribe: vi.fn(() => () => undefined),
    } as never);
    const rendered = render(<BrowserPaneGateway workspaceId="ws-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Capture region' }));
    rendered.rerender(<BrowserPaneGateway workspaceId="ws-2" />);
    capture.resolve({ mediaType: 'image/png', base64: 'AAAA' });

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('nativeBrowser.endCapture', {
        workspaceId: 'ws-1',
        tabId: 'tab-1',
      }),
    );
  });
});

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
