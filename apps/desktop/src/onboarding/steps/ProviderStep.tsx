/**
 * The provider-connect step — pick a provider from the catalog, then
 * either paste an API key (api-key providers) or run the real OAuth login
 * (oauth providers) via the shared {@link OAuthSignIn} flow, which opens the
 * browser and collects any pasted token / code. The auth kind re-resolves
 * whenever the provider changes. Applies on first run and whenever the
 * recovery gate finds no provider.
 */

import { useEffect, useState } from 'react';
import { decodeError, toErrorMessage } from '@moxxy/client-core';
import { api } from '@moxxy/client-core';
import { retryWhileReconnecting } from '@moxxy/client-core';
import { StepCard, Nav, PrimaryButton, SuccessRow, inputStyle } from '../chrome';
import { OAuthSignIn } from '../../settings/shared/OAuthSignIn';

export function ProviderStep({
  onNext,
  onBack,
}: {
  readonly onNext: () => void;
  readonly onBack: () => void;
}): JSX.Element {
  const [catalog, setCatalog] = useState<ReadonlyArray<string>>([
    'anthropic',
    'openai',
    'openai-codex',
    'claude-code',
  ]);
  const [provider, setProvider] = useState('anthropic');
  const [authKind, setAuthKind] = useState<'oauth' | 'api-key'>('api-key');
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api()
      .invoke('settings.providerCatalog')
      .then((list) => {
        if (cancelled || list.length === 0) return;
        setCatalog(list);
        setProvider((cur) => (list.includes(cur) ? cur : list[0]!));
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
      await activateProvider();
      setDone(true);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  // OAuth providers sign in through the shared flow; once it reports success
  // we activate the provider (same vault→runner handoff as the key path).
  const onOauthSignedIn = (): void => {
    void (async () => {
      try {
        await activateProvider();
        setDone(true);
      } catch (e) {
        setError(toErrorMessage(e));
      }
    })();
  };

  return (
    <StepCard
      title="Connect a provider"
      sub={
        authKind === 'oauth'
          ? "We'll open your browser to finish signing in. Tokens land in the vault, encrypted."
          : "Drop in an API key from your provider. It's encrypted by the moxxy vault."
      }
    >
      <div
        style={{
          padding: '16px 18px',
          background: 'var(--color-card-bg)',
          border: '1px solid var(--color-card-border)',
          borderRadius: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-muted)' }}>
            Provider
          </span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            style={inputStyle}
          >
            {catalog.map((name) => (
              <option key={name} value={name}>
                {name}
                {name === 'openai-codex' || name === 'claude-code' ? ' · OAuth' : ''}
              </option>
            ))}
          </select>
        </label>
        {authKind === 'api-key' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-muted)' }}>
              API key
            </span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="sk-…"
              style={inputStyle}
            />
          </label>
        )}
        {error && (
          <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--color-red)' }}>
            {error}
          </p>
        )}
        {done && authKind === 'api-key' && <SuccessRow text="Key saved to the vault." />}
        {authKind === 'oauth' ? (
          <OAuthSignIn provider={provider} onSignedIn={onOauthSignedIn} />
        ) : (
          <PrimaryButton onClick={() => void saveKey()} disabled={saving || !secret.trim()}>
            {saving ? 'Saving…' : done ? 'Update key' : 'Save key'}
          </PrimaryButton>
        )}
      </div>
      <Nav onBack={onBack} onNext={onNext} nextLabel={done ? 'Continue' : 'Skip for now'} />
    </StepCard>
  );
}
