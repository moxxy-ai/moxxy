/** Personal account details, Clerk profile management, and device sync. */

import { DeviceSync } from './account/DeviceSync';
import { useState } from 'react';
import { TaskChooseOrganization, TaskResetPassword, TaskSetupMFA, useSession, useClerk, useUser } from '@clerk/react';
import { Button, Modal, ModalFooter, ConfirmModal, Icon } from '@moxxy/desktop-ui';
import { usePrefs } from '@moxxy/client-core';

interface Props {
  readonly tier: string | null;
  readonly onClose: () => void;
}

export function ProfileView({ tier, onClose }: Props): JSX.Element {
  const { user } = useUser();
  const { session } = useSession();
  const task = session?.currentTask?.key;
  const { signOut, openUserProfile } = useClerk();
  const { prefs } = usePrefs();
  const [error, setError] = useState('');
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [busy, setBusy] = useState(false);

  const primaryEmail = user?.primaryEmailAddress;
  const email = primaryEmail?.emailAddress ?? null;
  const fullName =
    user?.fullName ?? email ?? user?.username ?? 'Account';
  const joined = user?.createdAt ? new Date(user.createdAt) : null;
  const initials =
    fullName
      .match(/\b\w/g)
      ?.slice(0, 2)
      .join('')
      .toUpperCase() ?? 'M';

  const doSignOut = async (): Promise<void> => {
    setBusy(true);
    try {
      await signOut();
      onClose();
    } catch {
      setError('Sign-out failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal title="Account" onClose={onClose} width={420}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '6px 4px',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 52,
                height: 52,
                borderRadius: 'var(--radius-card)',
                background: 'var(--color-primary)',
                color: 'var(--color-on-primary)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: 'var(--type-section)',
                flexShrink: 0,
              }}
            >
              {initials}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 'var(--type-section)',
                  fontWeight: 700,
                  color: 'var(--color-text)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={fullName}
              >
                {fullName}
              </div>
              {email && fullName !== email && (
                <div
                  className="mono"
                  style={{
                    marginTop: 2,
                    fontSize: 'var(--type-meta)',
                    color: 'var(--color-text-dim)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={email}
                >
                  {email}
                </div>
              )}
            </div>
            {tier && <span style={tierBadgeStyle(tier)}>{tier}</span>}
          </div>

          <hr
            style={{
              border: 'none',
              borderTop: '1px solid var(--color-card-border)',
              margin: 0,
            }}
          />

          <dl
            style={{
              margin: 0,
              display: 'grid',
              gridTemplateColumns: '110px 1fr',
              rowGap: 8,
              columnGap: 14,
              fontSize: 'var(--type-row)',
            }}
          >
            <Detail label="Member since" value={joined ? joined.toLocaleDateString() : 'Just now'} />
            <Detail label="User ID" value={user?.id ?? '—'} mono />
            {prefs?.clerkUserId === user?.id && prefs?.signedInAt && (
              <Detail
                label="Last sign-in"
                value={new Date(prefs.signedInAt).toLocaleString()}
              />
            )}
          </dl>

          {session?.status === 'active' && user && (
            <Button variant="secondary" onClick={() => {
              onClose();
              openUserProfile();
            }}>
              {tier ? 'Manage account and billing' : 'Manage account'}
            </Button>
          )}
          {task === 'choose-organization' && <TaskChooseOrganization redirectUrlComplete="/" />}
          {task === 'reset-password' && <TaskResetPassword redirectUrlComplete="/" />}
          {task === 'setup-mfa' && <TaskSetupMFA redirectUrlComplete="/" />}
          {!task && session?.status === 'active' && import.meta.env.VITE_ACCOUNT_SYNC_URL?.trim() && user &&
            <DeviceSync key={user.id} />}
          {error && <p role="alert">{error}</p>}
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button
              variant="danger"
              onClick={() => setConfirmSignOut(true)}
              disabled={busy}
            >
              <Icon name="x" size={13} />
              Sign out
            </Button>
          </ModalFooter>
        </div>
      </Modal>
      {confirmSignOut && (
        <ConfirmModal
          title="Sign out?"
          message="You'll be returned to a guest session. Your workspaces and chats stay on this machine."
          confirmLabel="Sign out"
          destructive
          onCancel={() => setConfirmSignOut(false)}
          onConfirm={() => {
            setConfirmSignOut(false);
            void doSignOut();
          }}
        />
      )}
    </>
  );
}

function Detail({
  label,
  value,
  mono,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}): JSX.Element {
  return (
    <>
      <dt style={{ color: 'var(--color-text-dim)', fontWeight: 600 }}>{label}</dt>
      <dd
        className={mono ? 'mono' : undefined}
        title={value}
        style={{
          margin: 0,
          color: 'var(--color-text)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {value}
      </dd>
    </>
  );
}

function tierBadgeStyle(tier: string): React.CSSProperties {
  const isFree = tier.toLowerCase() === 'free';
  return {
    padding: '3px 10px',
    borderRadius: 'var(--radius-pill)',
    fontWeight: 700,
    fontSize: 'var(--type-label)',
    background: isFree
      ? 'color-mix(in srgb, var(--color-text-dim) 18%, transparent)'
      : 'var(--color-primary)',
    color: isFree ? 'var(--color-text-muted)' : 'var(--color-on-primary)',
    border: isFree
      ? '1px solid color-mix(in srgb, var(--color-text-dim) 32%, transparent)'
      : 'none',
    flexShrink: 0,
  };
}
