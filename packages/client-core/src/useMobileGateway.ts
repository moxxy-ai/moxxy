/**
 * Renderer-side state for the mobile gateway (Settings → Mobile).
 *
 * Fetches `mobileGateway.status` on mount, subscribes to the
 * `mobileGateway.changed` event so the QR / client count live-update, and
 * exposes the two mutations (toggle, rotate token). The bridge lifecycle all
 * happens main-side; this only reflects + drives it.
 *
 * Desktop-only: these commands are host-only (refused over the WS bridge), so a
 * remote client never sees this hook drive anything.
 */

import { useCallback, useEffect, useState } from 'react';
import type { MobileGatewayStatus } from '@moxxy/desktop-ipc-contract';
import { api } from './transport.js';
import { toErrorMessage } from './errors.js';

const DISABLED: MobileGatewayStatus = {
  enabled: false,
  host: null,
  port: null,
  connectUrl: null,
  token: null,
};

export interface UseMobileGateway {
  status: MobileGatewayStatus;
  loading: boolean;
  busy: boolean;
  error: string | null;
  setEnabled: (enabled: boolean) => Promise<void>;
  rotateToken: () => Promise<void>;
}

export function useMobileGateway(): UseMobileGateway {
  const [status, setStatus] = useState<MobileGatewayStatus>(DISABLED);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api()
      .invoke('mobileGateway.status')
      .then((s) => {
        if (alive) setStatus(s);
      })
      .catch(() => {
        // not-supported (no bridge in this host) → stay disabled, no error toast
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Live updates: enable/disable, token rotation, client connect/leave.
  useEffect(() => {
    const off = api().subscribe('mobileGateway.changed', (s: MobileGatewayStatus) => setStatus(s));
    return off;
  }, []);

  const setEnabled = useCallback(async (enabled: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await api().invoke('mobileGateway.setEnabled', { enabled }));
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const rotateToken = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await api().invoke('mobileGateway.rotateToken'));
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, loading, busy, error, setEnabled, rotateToken };
}
