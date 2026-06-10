/**
 * MobileTab renderer tests:
 *   1. The enable toggle calls mobileGateway.setEnabled.
 *   2. When enabled, the QR + connect URL render and the LAN-exposure warning
 *      is present.
 *   3. "Regenerate code" calls mobileGateway.rotateToken.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { MobileGatewayStatus } from '@moxxy/desktop-ipc-contract';
import { MobileTab } from './MobileTab';

interface IpcSpy {
  invokes: Array<{ channel: string; args: unknown }>;
}

const DISABLED: MobileGatewayStatus = {
  enabled: false,
  host: null,
  port: null,
  connectUrl: null,
  token: null,
};

const ENABLED: MobileGatewayStatus = {
  enabled: true,
  host: '192.168.1.7',
  port: 8765,
  connectUrl: 'ws://192.168.1.7:8765/?t=s3cret',
  token: 's3cret',
  clientCount: 1,
};

/** Install a fake transport whose `mobileGateway.status` returns `initial`,
 *  and whose `setEnabled` / `rotateToken` flip a recorded state. */
function installFakeApi(initial: MobileGatewayStatus): IpcSpy {
  const invokes: Array<{ channel: string; args: unknown }> = [];
  let current = initial;
  __setApiOverride({
    invoke: ((channel: string, args: unknown) => {
      invokes.push({ channel, args });
      if (channel === 'mobileGateway.status') return Promise.resolve(current);
      if (channel === 'mobileGateway.setEnabled') {
        current = (args as { enabled: boolean }).enabled ? ENABLED : DISABLED;
        return Promise.resolve(current);
      }
      if (channel === 'mobileGateway.rotateToken') {
        current = { ...ENABLED, token: 'rotated', connectUrl: 'ws://192.168.1.7:8765/?t=rotated' };
        return Promise.resolve(current);
      }
      return Promise.resolve(undefined);
    }) as never,
    subscribe: (() => () => undefined) as never,
  } as never);
  return { invokes };
}

beforeEach(() => {
  // jsdom has no clipboard by default; stub it for the copy button.
  Object.assign(navigator, {
    clipboard: { writeText: () => Promise.resolve() },
  });
});

afterEach(() => {
  __setApiOverride(null);
});

describe('MobileTab', () => {
  it('renders the enable toggle (off by default)', async () => {
    installFakeApi(DISABLED);
    render(<MobileTab />);
    const toggle = await screen.findByRole('switch', { name: /enable mobile gateway/i });
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    // No QR / warning while disabled.
    expect(screen.queryByTestId('mobile-qr')).toBeNull();
    expect(screen.queryByTestId('mobile-lan-warning')).toBeNull();
  });

  it('toggling on calls mobileGateway.setEnabled(true)', async () => {
    const spy = installFakeApi(DISABLED);
    render(<MobileTab />);
    const toggle = await screen.findByRole('switch', { name: /enable mobile gateway/i });
    fireEvent.click(toggle);
    await waitFor(() => {
      const call = spy.invokes.find((i) => i.channel === 'mobileGateway.setEnabled');
      expect(call).toBeTruthy();
      expect((call!.args as { enabled: boolean }).enabled).toBe(true);
    });
  });

  it('renders the QR, connect URL, and LAN-exposure warning when enabled', async () => {
    installFakeApi(ENABLED);
    render(<MobileTab />);
    // The QR renders asynchronously (qrcode.toString is a promise).
    await waitFor(() => {
      expect(screen.getByTestId('mobile-qr').querySelector('svg')).toBeTruthy();
    });
    expect(screen.getByTestId('mobile-connect-url').textContent).toBe(
      'ws://192.168.1.7:8765/?t=s3cret',
    );
    // The honest, prominent security warning must be present.
    const warning = screen.getByTestId('mobile-lan-warning');
    expect(warning.textContent).toMatch(/exposes your desktop on the local network/i);
    // Connected-client count surfaces.
    expect(screen.getByText(/1 device connected/i)).toBeTruthy();
  });

  it('"Regenerate code" calls mobileGateway.rotateToken', async () => {
    const spy = installFakeApi(ENABLED);
    render(<MobileTab />);
    const regen = await screen.findByTestId('mobile-regenerate');
    fireEvent.click(regen);
    await waitFor(() => {
      expect(spy.invokes.some((i) => i.channel === 'mobileGateway.rotateToken')).toBe(true);
    });
  });
});
