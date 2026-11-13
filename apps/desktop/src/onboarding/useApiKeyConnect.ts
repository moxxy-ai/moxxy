/**
 * The "I have an API key" path of the first-run question: pick a model service
 * Moxxy calls itself, paste its key, connect. A service that signs in through
 * the browser instead gets the shared sign-in. The coding agents are not
 * listed here: the plan and free choices cover them.
 */

import { useEffect, useState } from 'react';
import { api, decodeError, retryWhileReconnecting, toErrorMessage } from '@moxxy/client-core';
import type { ProviderCatalogEntry } from '@moxxy/desktop-ipc-contract';

/** Shown until `settings.providerCatalog` answers. */
const FALLBACK: ReadonlyArray<string> = ['anthropic', 'openai'];

const LABEL: Readonly<Record<string, string>> = { anthropic: 'Anthropic', openai: 'OpenAI' };

/** Where each known service hands out keys, opened from "Where do I get a key?". */
const KEY_PAGE: Readonly<Record<string, string>> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
};

export function serviceLabel(name: string): string {
  return LABEL[name] ?? name.charAt(0).toUpperCase() + name.slice(1);
}

export interface ApiKeyConnect {
  readonly services: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  readonly service: string;
  readonly setService: (name: string) => void;
  readonly signsInWithBrowser: boolean;
  readonly secret: string;
  readonly setSecret: (value: string) => void;
  readonly saving: boolean;
  readonly error: string | null;
  readonly canConnect: boolean;
  readonly connect: () => Promise<void>;
  readonly onSignedIn: () => Promise<void>;
  /** Opens the service's key page; null when Moxxy does not know it. */
  readonly openKeyPage: (() => void) | null;
}

export function useApiKeyConnect(onConnected: () => void): ApiKeyConnect {
  const [names, setNames] = useState<ReadonlyArray<string>>(FALLBACK);
  const [service, setService] = useState<string>(FALLBACK[0] ?? 'anthropic');
  const [authKind, setAuthKind] = useState<'oauth' | 'api-key'>('api-key');
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api()
      .invoke('settings.providerCatalog')
      .then((list: ReadonlyArray<ProviderCatalogEntry>) => {
        const apis = list.filter((entry) => entry.kind === 'api').map((entry) => entry.name);
        if (cancelled || apis.length === 0) return;
        setNames(apis);
        setService((cur) => (apis.includes(cur) ? cur : (apis[0] ?? cur)));
      })
      .catch(() => {
        /* keep the fallback */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void api()
      .invoke('onboarding.providerAuthKind', { provider: service })
      .then((kind) => {
        if (!cancelled) setAuthKind(kind);
      })
      .catch(() => {
        if (!cancelled) setAuthKind('api-key');
      });
    return () => {
      cancelled = true;
    };
  }, [service]);

  const connect = async (): Promise<void> => {
    if (!secret.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api().invoke('onboarding.saveProviderKey', { provider: service, secret: secret.trim() });
      setSecret('');
      // A key-based service is not bundled: provisioning installs it and
      // restarts the runner on it, which also makes it the active one.
      await api().invoke('onboarding.provisionProvider', { provider: service });
      onConnected();
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  // A browser sign-in can outlast the runner link (on Windows the socket
  // sometimes drops over that detour), so only that error is retried.
  const onSignedIn = async (): Promise<void> => {
    await retryWhileReconnecting(() => api().invoke('session.setProvider', { provider: service }), {
      isReconnecting: (e) => decodeError(e).code === 'not-connected',
    });
    onConnected();
  };

  const keyPage = KEY_PAGE[service];
  return {
    services: names.map((name) => ({ value: name, label: serviceLabel(name) })),
    service,
    setService,
    signsInWithBrowser: authKind === 'oauth',
    secret,
    setSecret,
    saving,
    error,
    canConnect: secret.trim() !== '' && !saving,
    connect,
    onSignedIn,
    openKeyPage: keyPage ? () => void api().invoke('onboarding.openExternal', { url: keyPage }).catch(() => undefined) : null,
  };
}
