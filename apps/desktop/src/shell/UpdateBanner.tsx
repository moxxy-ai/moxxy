/**
 * Top-of-window banner that offers the update found by the launch check. It is
 * the update people who aren't technical see, so it asks nothing: one
 * "Update" brings the app, the runner and the extensions up to date and
 * restarts Moxxy onto them ({@link useAppUpdate}'s `runUpdateAll`). A failure
 * says Moxxy still works and offers another try. It can be dismissed.
 */

import { useState } from 'react';
import { assertDefined } from '@/lib/assert';
import { api } from '@moxxy/client-core';
import { useAppUpdate } from '@moxxy/client-core';
import { Button } from '@moxxy/desktop-ui';

export function UpdateBanner(): JSX.Element | null {
  const { check, state, progress, error, runUpdateAll, relaunch } = useAppUpdate({ autoCheck: true });
  const [dismissed, setDismissed] = useState(false);

  const offered = state === 'available' || state === 'incompatible' || state === 'requires-full-update';
  const visible = !dismissed && (offered || state === 'updating' || state === 'staged' || state === 'error');
  if (!visible) return null;

  const pct =
    progress?.total && progress.received != null
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : null;

  let body: JSX.Element;
  if (state === 'updating') {
    body = <span>Updating Moxxy… {pct != null ? `${pct}%` : (progress?.message ?? '')}</span>;
  } else if (state === 'staged') {
    body = (
      <>
        <span>Restarting Moxxy…</span>
        <Button variant="cta" style={primaryBtn} onClick={relaunch}>
          Restart now
        </Button>
      </>
    );
  } else if (state === 'error') {
    body = (
      <>
        <span style={{ color: 'var(--color-red)' }}>{error}</span>
        <Button variant="cta" style={primaryBtn} onClick={() => void runUpdateAll()}>
          Try again
        </Button>
      </>
    );
  } else {
    body = (
      <>
        <span>A Moxxy update is available.</span>
        <Button variant="cta" style={primaryBtn} onClick={() => void runUpdateAll()}>
          Update
        </Button>
        {state === 'requires-full-update' && error && check?.releaseUrl && (
          <Button
            variant="cta"
            style={primaryBtn}
            onClick={() => {
              const url = check?.releaseUrl;
              assertDefined(url, 'release URL present when the manual-fallback button is shown');
              void api().invoke('onboarding.openExternal', { url });
            }}
          >
            Get it manually
          </Button>
        )}
      </>
    );
  }

  return (
    <div role="status" style={wrap}>
      {body}
      {offered && error && <span style={{ color: 'var(--color-red)' }}>{error}</span>}
      {state !== 'updating' && state !== 'staged' && (
        <button
          type="button"
          aria-label="Dismiss"
          style={dismissBtn}
          onClick={() => setDismissed(true)}
        >
          ✕
        </button>
      )}
    </div>
  );
}

const wrap: React.CSSProperties = {
  position: 'fixed',
  top: 10,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 60,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 12px',
  background: 'var(--color-card-bg)',
  border: '1px solid var(--color-card-border)',
  borderRadius: 'var(--radius-card)',
  boxShadow: 'var(--color-card-shadow)',
  fontSize: 'var(--type-ui)',
  color: 'var(--color-text)',
  maxWidth: '80vw',
};

const primaryBtn: React.CSSProperties = {
  padding: '0 12px',
  fontSize: 'var(--type-row)',
  fontWeight: 600,
};

const dismissBtn: React.CSSProperties = {
  padding: '2px 6px',
  fontSize: 'var(--type-row)',
  color: 'var(--color-text-dim)',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
};
