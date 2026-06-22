/**
 * Accessibility + re-entrancy regression tests for the gallery install tile.
 *
 * The install lifecycle is driven entirely by the @moxxy/client-core transport
 * (`apps.status` / `apps.install` / `apps.uninstall` + the `apps.install.progress`
 * subscription), so the whole card can be exercised by stubbing that transport —
 * no Electron main process needed. We assert the behaviours that have no visual
 * fallback for a screen-reader user (the live-region announcement, the
 * progressbar ARIA, the error alert) and the busy guard that stops a fast
 * double-click firing two concurrent installs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { AppInstallStatus } from '@moxxy/desktop-ipc-contract';
import { AppCard } from './AppCard';
import type { DesktopAppDef } from './registry';

function NoopApp(): JSX.Element {
  return <div />;
}

const DEF: DesktopAppDef = {
  id: 'demo',
  name: 'Demo App',
  description: 'A test app',
  icon: 'lock',
  requiresInstall: true,
  installSummary: 'Downloads ~10 MB.',
  Component: NoopApp,
};

/** A controllable transport: queues `apps.install` resolutions and lets the test
 *  push `apps.install.progress` events to the card's subscriber. */
function makeTransport() {
  let progressHandler: ((p: unknown) => void) | null = null;
  let resolveInstall: ((s: AppInstallStatus) => void) | null = null;
  const statusByCall: AppInstallStatus[] = [{ appId: 'demo', state: 'not-installed' }];
  const invoke = vi.fn((channel: string) => {
    if (channel === 'apps.status') return Promise.resolve(statusByCall.shift() ?? statusByCall[0]);
    if (channel === 'apps.install') {
      return new Promise<AppInstallStatus>((res) => {
        resolveInstall = res;
      });
    }
    if (channel === 'apps.uninstall')
      return Promise.resolve({ appId: 'demo', state: 'not-installed' } as AppInstallStatus);
    return Promise.resolve(null);
  });
  const subscribe = vi.fn((channel: string, handler: (p: unknown) => void) => {
    if (channel === 'apps.install.progress') progressHandler = handler;
    return () => {
      progressHandler = null;
    };
  });
  return {
    api: { invoke, subscribe } as never,
    invoke,
    pushProgress: (p: unknown) => act(() => progressHandler?.(p)),
    finishInstall: (s: AppInstallStatus) => act(() => resolveInstall?.(s)),
  };
}

let transport: ReturnType<typeof makeTransport>;

beforeEach(() => {
  transport = makeTransport();
  __setApiOverride(transport.api);
});
afterEach(() => {
  __setApiOverride(null);
  vi.restoreAllMocks();
});

describe('AppCard accessibility + re-entrancy', () => {
  it('exposes a status live region for screen readers', async () => {
    render(<AppCard def={DEF} onOpen={vi.fn()} />);
    const live = await screen.findByTestId('app-status-demo');
    // It IS a live region (role + aria-live) so install transitions are spoken.
    expect(live).toHaveAttribute('role', 'status');
    expect(live).toHaveAttribute('aria-live', 'polite');
  });

  it('announces the install start and renders a progressbar with ARIA values', async () => {
    render(<AppCard def={DEF} onOpen={vi.fn()} />);
    const installBtn = await screen.findByTestId('install-demo');
    fireEvent.click(installBtn);

    // The card flips to the installing branch and the SR announcement names it.
    const live = screen.getByTestId('app-status-demo');
    await waitFor(() => expect(live.textContent).toMatch(/installing demo app/i));

    // Push a download-progress event; the bar must carry real progressbar ARIA.
    await transport.pushProgress({
      appId: 'demo',
      phase: 'downloading',
      receivedBytes: 4_000_000,
      totalBytes: 10_000_000,
    });
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar.getAttribute('aria-valuetext')).toMatch(/4 MB of 10 MB/i);
  });

  it('does not fire a second install while one is in flight (busy guard)', async () => {
    render(<AppCard def={DEF} onOpen={vi.fn()} />);
    const installBtn = await screen.findByTestId('install-demo');
    const before = transport.invoke.mock.calls.filter((c) => c[0] === 'apps.install').length;

    // Two fast clicks before the first install resolves.
    fireEvent.click(installBtn);
    fireEvent.click(installBtn);
    await Promise.resolve();

    const after = transport.invoke.mock.calls.filter((c) => c[0] === 'apps.install').length;
    expect(after - before).toBe(1); // the second click is swallowed by the busy guard
  });

  it('surfaces an install failure as an assertive alert with a Retry action', async () => {
    render(<AppCard def={DEF} onOpen={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('install-demo'));
    await transport.finishInstall({ appId: 'demo', state: 'error', error: 'network down' });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/network down/i);
    // The SR live region also reports the failure.
    expect(screen.getByTestId('app-status-demo').textContent).toMatch(/failed to install/i);
    expect(screen.getByRole('button', { name: /retry install/i })).toBeInTheDocument();
  });
});
