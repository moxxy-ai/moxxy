import { useState } from 'react';
import { Button, Modal } from '@moxxy/desktop-ui';
import { usePrefs } from '@moxxy/client-core';

/**
 * The account panel of a build without a Clerk key (a source checkout). It
 * shows the stored identity and says plainly that sign-in needs a key. Not
 * `ProfileView`: that one reads Clerk hooks, which throw outside a ClerkProvider.
 */
export function LocalAccountView({
  name,
  onClose,
}: {
  readonly name: string | null;
  readonly onClose: () => void;
}): JSX.Element {
  const { update } = usePrefs();
  const [busy, setBusy] = useState(false);

  // No Clerk session to end, so signing out clears the identity this machine
  // stored: the same three prefs ProfileView clears after signOut().
  const doSignOut = async (): Promise<void> => {
    setBusy(true);
    try {
      await update({ clerkUserId: null, clerkDisplayName: null, signedInAt: null });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Account" onClose={onClose} width={420}>
      <div className="account-panel">
        <div className="form__field">
          <span className="form__label">Signed in as</span>
          <span className="account-panel__value">{name ?? 'Not signed in'}</span>
        </div>
        <div className="form__field">
          <span className="form__label">Tier</span>
          <span className="account-panel__value">Free</span>
        </div>
        <p className="form__hint account-panel__hint">
          This build has no Clerk publishable key, so sign-in is unavailable. Set
          VITE_CLERK_PUBLISHABLE_KEY to enable accounts.
        </p>
        {name && (
          <div className="form__acts">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void doSignOut()}
              data-testid="local-sign-out"
              style={{ color: 'var(--color-red-text)', borderColor: 'var(--color-red-border)' }}
            >
              {busy ? 'Signing out…' : 'Sign out'}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
