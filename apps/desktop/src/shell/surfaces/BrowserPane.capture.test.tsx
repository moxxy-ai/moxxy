/**
 * BrowserPane region capture → chat attach.
 *   1. Dragging a box in capture mode sends a `capture` surface input
 *      (normalized region) to the runner.
 *   2. A `captured` payload (the sharp PNG, streamed back as surface.data) is
 *      persisted via session.saveImageAttachment AND emitted to the composer as
 *      an attachment (the same FILE_INSERT_EVENT the file tree uses).
 * Regression for "I select a region and nothing reaches the chat input".
 */
import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import { BrowserPane } from './BrowserPane';
import { FILE_INSERT_EVENT } from '../WorkspaceFiles';

function installFakeApi(): {
  inputs: Array<{ type: string; [k: string]: unknown }>;
  saveCalls: unknown[];
  fireData: (payload: unknown) => void;
} {
  const inputs: Array<{ type: string; [k: string]: unknown }> = [];
  const saveCalls: unknown[] = [];
  let dataCb: ((d: unknown) => void) | null = null;
  __setApiOverride({
    invoke: ((channel: string, args: unknown) => {
      if (channel === 'surface.open') {
        return Promise.resolve({
          surfaceId: 'surf-1',
          snapshot: { type: 'frame', base64: 'AAAA', mime: 'image/jpeg', url: 'https://e.com' },
        });
      }
      if (channel === 'surface.input') {
        inputs.push((args as { message: { type: string } }).message);
        return Promise.resolve(undefined);
      }
      if (channel === 'session.saveImageAttachment') {
        saveCalls.push(args);
        return Promise.resolve({ path: '/tmp/x/browser-capture.png', name: 'browser-capture.png' });
      }
      return Promise.resolve(undefined);
    }) as never,
    subscribe: ((event: string, cb: (d: unknown) => void) => {
      if (event === 'surface.data') dataCb = cb;
      return () => undefined;
    }) as never,
  } as never);
  return {
    inputs,
    saveCalls,
    fireData: (payload) => dataCb?.({ workspaceId: 'ws-1', data: { surfaceId: 'surf-1', payload } }),
  };
}

afterEach(async () => {
  cleanup();
  await Promise.resolve();
  __setApiOverride(null);
});

describe('BrowserPane region capture → chat attach', () => {
  it('drag in capture mode sends a normalized capture input', async () => {
    const spy = installFakeApi();
    const { container } = render(<BrowserPane workspaceId="ws-1" />);
    await waitFor(() => expect(screen.queryByText(/Browser unavailable/i)).toBeNull());

    fireEvent.click(screen.getByLabelText('Capture region'));
    const host = container.querySelector('[tabindex="0"]') as HTMLElement;
    // jsdom getBoundingClientRect is 0×0 — stub a real pane size.
    host.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} }) as DOMRect;

    fireEvent.mouseDown(host, { clientX: 80, clientY: 60 });
    fireEvent.mouseMove(host, { clientX: 480, clientY: 360 });
    fireEvent.mouseUp(host, { clientX: 480, clientY: 360 });

    const cap = spy.inputs.find((m) => m.type === 'capture');
    expect(cap, 'a capture input should be sent').toBeTruthy();
    expect(cap).toMatchObject({ type: 'capture', fx: 0.1, fy: 0.1, fw: 0.5, fh: 0.5 });
  });

  it('a captured payload is saved and emitted to the composer as an attachment', async () => {
    const spy = installFakeApi();
    render(<BrowserPane workspaceId="ws-1" />);
    await waitFor(() => expect(screen.queryByText(/Browser unavailable/i)).toBeNull());

    const inserts: Array<{ absPath?: string }> = [];
    const onInsert = (e: Event): void => {
      inserts.push((e as CustomEvent).detail);
    };
    window.addEventListener(FILE_INSERT_EVENT, onInsert);

    spy.fireData({ type: 'captured', base64: 'PNGDATA', mediaType: 'image/png' });

    await waitFor(() => expect(spy.saveCalls.length).toBe(1));
    expect(spy.saveCalls[0]).toMatchObject({ dataBase64: 'PNGDATA', mediaType: 'image/png' });
    await waitFor(() => expect(inserts.length).toBe(1));
    expect(inserts[0]).toMatchObject({ absPath: '/tmp/x/browser-capture.png' });
    window.removeEventListener(FILE_INSERT_EVENT, onInsert);
  });
});
