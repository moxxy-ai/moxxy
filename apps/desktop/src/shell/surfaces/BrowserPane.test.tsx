/**
 * BrowserPane keyboard forwarding:
 *   The frame surface forwards typing + a small set of control keys to the
 *   remote page. It must preventDefault on those keys so Tab/arrows/Backspace
 *   drive the page only and never leak to the host UI (focus loss / scroll /
 *   navigation). Regression for the "keys leak to host" bug.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import { BrowserPane } from './BrowserPane';

/** Fake transport that opens the surface immediately and records inputs. */
function installFakeApi(): { inputs: unknown[] } {
  const inputs: unknown[] = [];
  __setApiOverride({
    invoke: ((channel: string, args: unknown) => {
      if (channel === 'surface.open') return Promise.resolve({ surfaceId: 'surf-1' });
      if (channel === 'surface.input') {
        inputs.push((args as { message: unknown }).message);
        return Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    }) as never,
    subscribe: (() => () => undefined) as never,
  } as never);
  return { inputs };
}

afterEach(async () => {
  // Unmount (firing useSurface's async surface.close) while the fake transport
  // is still installed, then yield a microtask so that close lands before we
  // tear the override down — otherwise the deferred cleanup hits a missing
  // transport.
  cleanup();
  await Promise.resolve();
  __setApiOverride(null);
});

describe('BrowserPane keyboard forwarding', () => {
  it('preventDefaults forwarded keys (Tab/arrows) and proxies them to the page', async () => {
    const spy = installFakeApi();
    const { container } = render(<BrowserPane workspaceId="ws-1" />);

    // The frame box is the focusable (tabIndex=0) div carrying onKeyDown.
    const surfaceEl = container.querySelector('[tabindex="0"]') as HTMLElement;
    expect(surfaceEl).toBeTruthy();

    // Wait for surface.open to resolve (ready) so input() is no longer a no-op.
    await waitFor(() => expect(screen.queryByText(/Browser unavailable/i)).toBeNull());

    for (const key of ['Tab', 'ArrowDown', 'a']) {
      const evt = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      surfaceEl.dispatchEvent(evt);
      // The forwarded key must be consumed so it doesn't reach the host UI.
      expect(evt.defaultPrevented).toBe(true);
    }

    await waitFor(() => expect(spy.inputs.length).toBe(3));
    expect(spy.inputs).toEqual([
      { type: 'key', key: 'Tab' },
      { type: 'key', key: 'ArrowDown' },
      { type: 'key', key: 'a' },
    ]);
  });

  it('does not preventDefault keys it does not forward (e.g. F5)', async () => {
    installFakeApi();
    const { container } = render(<BrowserPane workspaceId="ws-1" />);
    const surfaceEl = container.querySelector('[tabindex="0"]') as HTMLElement;
    await waitFor(() => expect(screen.queryByText(/Browser unavailable/i)).toBeNull());

    const evt = new KeyboardEvent('keydown', { key: 'F5', bubbles: true, cancelable: true });
    surfaceEl.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(false);
  });
});
