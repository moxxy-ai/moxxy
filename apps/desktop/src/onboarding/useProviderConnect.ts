/**
 * The onboarding provider step's state — pick a provider from the catalog,
 * grouped so a coding agent (it works through its own SDK, on its own sign-in)
 * reads apart from a model API Moxxy calls itself; then either paste an API key
 * (api-key providers) or run the real OAuth login (oauth providers).
 */

import { useEffect, useState } from 'react';
import { assertDefined } from '@/lib/assert';
import { api, decodeError, retryWhileReconnecting, toErrorMessage, useSettings } from '@moxxy/client-core';
import type { ProviderCatalogEntry } from '@moxxy/desktop-ipc-contract';
import { useAgentConnections } from '../settings/agents/useAgentConnections';

/** Static fallback catalog (used until `settings.providerCatalog` resolves). */
const FALLBACK_CATALOG: ReadonlyArray<ProviderCatalogEntry> = [
  { name: 'anthropic', kind: 'api' },
  { name: 'openai', kind: 'api' },
  { name: 'openai-codex', kind: 'api' },
  { name: 'claude-code', kind: 'agent' },
  { name: 'codex-agent', kind: 'agent' },
  { name: 'opencode', kind: 'agent' },
];

/** Providers known to authenticate via OAuth — a best-effort visual hint for the
 *  *non-selected* options (the selected one's tag is driven by the authoritative
 *  `authKind` the backend resolves, so the two can never disagree there). */
const OAUTH_PROVIDER_IDS = new Set(['openai-codex', 'claude-code', 'codex-agent', 'opencode']);

/** The picker's groups, in the order Settings lists them: agents first. */
const GROUPS: ReadonlyArray<{ readonly kind: ProviderCatalogEntry['kind']; readonly label: string }> = [
  { kind: 'agent', label: 'Coding agents · SDK' },
  { kind: 'api', label: 'Model APIs' },
];

export interface ProviderOptionGroup {
  readonly label: string;
  readonly options: ReadonlyArray<{ readonly value: string; readonly label: string }>;
}

export interface ProviderConnect {
  /** The catalog as the picker shows it; an empty group is left out. */
  readonly groups: ReadonlyArray<ProviderOptionGroup>;
  readonly provider: string;
  readonly setProvider: (name: string) => void;
  readonly authKind: 'oauth' | 'api-key';
  readonly secret: string;
  readonly setSecret: (value: string) => void;
  readonly saving: boolean;
  readonly error: string | null;
  readonly done: boolean;
  readonly saveKey: () => Promise<void>;
  readonly onOauthSignedIn: () => Promise<void>;
  /** The picked agent connection's row (its CLI may need installing first). */
  readonly agent: ReturnType<typeof useAgentConnections>;
}

export function useProviderConnect(): ProviderConnect {
  const [catalog, setCatalog] = useState<ReadonlyArray<ProviderCatalogEntry>>(FALLBACK_CATALOG);
  const [provider, setProvider] = useState('anthropic');
  const [authKind, setAuthKind] = useState<'oauth' | 'api-key'>('api-key');
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const { providers } = useSettings();
  const agent = useAgentConnections(providers.filter((p) => p.name === provider));

  useEffect(() => {
    let cancelled = false;
    void api()
      .invoke('settings.providerCatalog')
      .then((list) => {
        if (cancelled || list.length === 0) return;
        setCatalog(list);
        const first = list[0];
        assertDefined(first, 'catalog has a first entry when non-empty');
        setProvider((cur) => (list.some((entry) => entry.name === cur) ? cur : first.name));
      })
      .catch(() => {
        /* keep static fallback */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh the auth kind every time the selected provider changes so
  // the UI flips between "Paste API key" and "Sign in with browser".
  useEffect(() => {
    let cancelled = false;
    setDone(false);
    setError(null);
    void api()
      .invoke('onboarding.providerAuthKind', { provider })
      .then((kind) => {
        if (!cancelled) setAuthKind(kind);
      })
      .catch(() => {
        if (!cancelled) setAuthKind('api-key');
      });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  // After a credential lands in the vault, tell the RUNNING runner to activate
  // this provider. The runner booted with no active provider (no creds existed
  // yet, so `serve` tolerated it), so without this it never gains an
  // activeProvider — the app's `connectedWithoutProvider` gate never clears and
  // onboarding loops forever. setProvider re-resolves the credential from the
  // vault and makes the runner usable; the gate then drops on its own.
  //
  // The runner link can be MID-RECONNECT here: the OAuth flow takes the user on
  // a long browser detour, and on Windows the runner socket sometimes drops over
  // that window — the supervisor re-establishes within a few seconds, but a
  // setProvider fired into the gap throws "not connected to a runner". So retry
  // across a reconnect (only on that specific error) instead of failing the
  // whole login the user just completed.
  const activateProvider = async (): Promise<void> => {
    await retryWhileReconnecting(() => api().invoke('session.setProvider', { provider }), {
      isReconnecting: (e) => decodeError(e).code === 'not-connected',
    });
  };

  const saveKey = async (): Promise<void> => {
    if (!secret.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api().invoke('onboarding.saveProviderKey', {
        provider,
        secret: secret.trim(),
      });
      setSecret('');
      // API-key providers are NOT bundled (slim kernel): install + provision the
      // package on demand, which also restarts the runner so it activates the
      // provider. Without this, `setActive` throws "Provider not registered" and
      // onboarding loops forever. (OAuth providers are bundled → setProvider in
      // onOauthSignedIn.)
      await api().invoke('onboarding.provisionProvider', { provider });
      setDone(true);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  // OAuth providers sign in through the shared flow; once it reports success
  // we activate the provider (same vault→runner handoff as the key path).
  const onOauthSignedIn = async (): Promise<void> => {
    await activateProvider();
    setDone(true);
  };

  // For the selected provider use the authoritative authKind the backend
  // resolved; for the rest fall back to the static hint set. This removes the
  // chance of the tag and the actual auth flow disagreeing for the option the
  // user is acting on.
  const isOauth = (name: string): boolean =>
    name === provider ? authKind === 'oauth' : OAUTH_PROVIDER_IDS.has(name);
  const groups = GROUPS.map(({ kind, label }) => ({
    label,
    options: catalog
      .filter((entry) => entry.kind === kind)
      // Every agent signs in; the tag only tells the APIs apart.
      .map(({ name }) => ({ value: name, label: kind === 'api' && isOauth(name) ? `${name} · OAuth` : name })),
  })).filter((group) => group.options.length > 0);

  return {
    groups,
    provider,
    setProvider,
    authKind,
    secret,
    setSecret,
    saving,
    error,
    done,
    saveKey,
    onOauthSignedIn,
    agent,
  };
}
