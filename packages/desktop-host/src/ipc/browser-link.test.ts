import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: () => undefined } }));

import type { IpcCommandName } from '@moxxy/desktop-ipc-contract';
import type { CommandBus } from '@moxxy/desktop-ipc-contract/bus';
import { setActiveBus } from './shared';
import { registerBrowserLinkHandlers } from './browser-link';

type Handler = (...args: unknown[]) => Promise<unknown>;

function register(show?: (url: string) => void): (url: string) => Promise<unknown> {
  const handlers = new Map<string, Handler>();
  setActiveBus({
    handle: (channel: IpcCommandName, handler: Handler) => handlers.set(channel, handler),
  } as unknown as CommandBus);
  registerBrowserLinkHandlers(show);
  const handler = handlers.get('browser.showUrl');
  if (!handler) throw new Error('browser.showUrl was not registered');
  return (url) => handler({ url });
}

describe('browser.showUrl (Open in Moxxy browser from a link menu)', () => {
  it('hands a web address to the main window', async () => {
    // The main window is the boundary: recorded, not shown.
    const shown: string[] = [];
    const showUrl = register((url) => void shown.push(url));

    await showUrl('https://github.com/moxxy-ai/moxxy');
    expect(shown).toEqual(['https://github.com/moxxy-ai/moxxy']);
  });

  it('refuses anything but http(s)', async () => {
    const shown: string[] = [];
    const showUrl = register((url) => void shown.push(url));

    await expect(showUrl('file:///etc/passwd')).rejects.toThrow(/unsafe/u);
    await expect(showUrl('javascript:alert(1)')).rejects.toThrow(/unsafe/u);
    expect(shown).toEqual([]);
  });

  it('says the browser is not there when no main window can show it', async () => {
    await expect(register()('https://a.b')).rejects.toThrow(/unavailable/u);
  });
});
