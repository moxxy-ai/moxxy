/**
 * Top-of-window banner that surfaces a dashboard update found by the launch
 * auto-check. Stays out of the way: it only appears when there's something to
 * act on (a compatible hot-update, an in-progress install, a staged update
 * waiting for relaunch, or a Tier-2 "needs a full app update" notice) and can be
 * dismissed. The heavy lifting lives in {@link useAppUpdate}.
 */

import { useState } from 'react';
import { api } from '@/lib/api';
import { useAppUpdate } from '@/lib/useAppUpdate';

export function UpdateBanner(): JSX.Element | null {
  const { check, state, progress, error, stagedVersion, runUpdate, relaunch } = useAppUpdate({
    autoCheck: true,
  });
  const [dismissed, setDismissed] = useState(false);

  const visible =
    !dismissed && (state === 'available' || state === 'updating' || state === 'staged' || state === 'incompatible');
  if (!visible) return null;

  const pct =
    progress?.total && progress.received != null
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : null;

  let body: JSX.Element;
  if (state === 'available') {
    body = (
      <>
        <span>
          Dashboard update <strong>v{check?.latestVersion}</strong> available
          {check?.notes ? ` — ${check.notes}` : ''}
        </span>
        <button type="button" style={primaryBtn} onClick={() => void runUpdate()}>
          Update
        </button>
      </>
    );
  } else if (state === 'updating') {
    body = (
      <span>
        Updating dashboard… {pct != null ? `${pct}%` : (progress?.message ?? '')}
      </span>
    );
  } else if (state === 'staged') {
    body = (
      <>
        <span>
          Updated to <strong>v{stagedVersion}</strong>. Relaunch to apply.
        </span>
        <button type="button" style={primaryBtn} onClick={relaunch}>
          Relaunch
        </button>
      </>
    );
  } else {
    // incompatible → Tier-2 (full app update)
    body = (
      <>
        <span>A new version needs a full app update.</span>
        {check?.releaseUrl && (
          <button
            type="button"
            style={primaryBtn}
            onClick={() =>
              void api().invoke('onboarding.openExternal', { url: check.releaseUrl! })
            }
          >
            Get update
          </button>
        )}
      </>
    );
  }

  return (
    <div role="status" style={wrap}>
      {body}
      {error && <span style={{ color: 'var(--color-red)' }}>{error}</span>}
      {state !== 'updating' && (
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
  borderRadius: 12,
  boxShadow: '0 18px 36px -18px rgba(15, 23, 42, 0.3)',
  fontSize: 13,
  color: 'var(--color-text)',
  maxWidth: '80vw',
};

const primaryBtn: React.CSSProperties = {
  padding: '5px 12px',
  fontSize: 12.5,
  fontWeight: 600,
  borderRadius: 8,
  color: '#fff',
  background: 'var(--color-primary)',
  cursor: 'pointer',
  border: 'none',
};

const dismissBtn: React.CSSProperties = {
  padding: '2px 6px',
  fontSize: 12,
  color: 'var(--color-text-dim)',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
};
