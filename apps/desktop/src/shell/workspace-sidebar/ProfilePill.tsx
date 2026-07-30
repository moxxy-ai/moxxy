import { useEffect, useState } from 'react';
import { useAuth, useClerk, useUser } from '@clerk/clerk-react';
import { Button, Icon, Modal } from '@moxxy/desktop-ui';
import { usePrefs } from '@moxxy/client-core';
import { ProfileView } from '../ProfileView';

const HAS_CLERK_KEY = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim());

/**
 * Bottom-of-rail profile row. Doubles as a presence indicator: signed-out
 * renders a "Sign in" prompt that opens Clerk's own modal
 * (`clerk.openSignIn()` — this is the only sign-in entry point, no longer
 * an onboarding step); signed-in shows the display name plus a tier badge
 * and opens the full account view on click. There is no "Guest" state — the
 * row is always either Sign in or the profile. A top border separates it
 * from the scrolling workspace list above.
 */
export function ProfilePill({ compact = false }: { readonly compact?: boolean } = {}): JSX.Element {
  return HAS_CLERK_KEY ? <ClerkProfilePill compact={compact} /> : <KeylessProfilePill compact={compact} />;
}

/** Initials from a display name, for the rail's avatar tile. Falls back to the
 *  first character so a single-word name still renders something. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** The rail form of the profile row: a 26px tile, since the rail is icon-only.
 *  Every state the full row has (sign in / signed in) still has a tile. */
function AvatarTile({
  label,
  title,
  onClick,
  disabled,
}: {
  readonly label: string | null;
  readonly title: string;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      className="rail-avatar"
      data-testid="profile-avatar"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
    >
      {label ?? <Icon name="agent" size={13} />}
    </button>
  );
}

/**
 * The account row when the build carries no Clerk key (a source checkout).
 *
 * It used to render a DISABLED tile: a control you can see, cannot press, and
 * which never says why — the account entry read as simply missing. It opens the
 * local account panel now, which shows the stored identity and states plainly
 * that sign-in needs a key rather than pretending the button is broken.
 */
function KeylessProfilePill({ compact }: { readonly compact: boolean }): JSX.Element {
  const { prefs } = usePrefs();
  const [open, setOpen] = useState(false);
  const displayName = prefs?.clerkDisplayName ?? null;
  const panel = open && <LocalAccountView name={displayName} onClose={() => setOpen(false)} />;

  if (compact) {
    return (
      <>
        <AvatarTile
          label={displayName ? initialsOf(displayName) : null}
          title={displayName ?? 'Account'}
          onClick={() => setOpen(true)}
        />
        {panel}
      </>
    );
  }

  return (
    <div style={{ borderTop: '1px solid var(--color-sidebar-border)', padding: 'var(--space-6) var(--space-6) var(--space-8)' }}>
      <button
        type="button"
        className="row-button"
        onClick={() => setOpen(true)}
        style={profileRowStyle(
          displayName ? 'var(--color-sidebar-text)' : 'var(--color-primary-strong)',
        )}
      >
        {!displayName && <Icon name="agent" size={14} style={{ flexShrink: 0 }} />}
        <span
          style={profileLabelStyle(
            displayName ? 'var(--color-sidebar-text)' : 'var(--color-primary-strong)',
          )}
        >
          {displayName ?? 'Sign in'}
        </span>
        {displayName ? (
          <span style={tierBadgeStyle('Free')}>Free</span>
        ) : (
          <Icon name="chevron-right" size={14} style={{ flexShrink: 0 }} />
        )}
      </button>
      {panel}
    </div>
  );
}

/** The keyless account panel. Deliberately NOT {@link ProfileView}: that one
 *  reads `useUser()`/`useClerk()`, which throw outside a ClerkProvider. */
function LocalAccountView({
  name,
  onClose,
}: {
  readonly name: string | null;
  readonly onClose: () => void;
}): JSX.Element {
  const { update } = usePrefs();
  const [busy, setBusy] = useState(false);

  // No Clerk session to end, so signing out means clearing the identity this
  // machine stored — the same three prefs ProfileView clears after signOut().
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-16)' }}>
        <div className="form__field">
          <span className="form__label">signed in as</span>
          <span style={{ fontSize: 'var(--type-ui)' }}>{name ?? 'Not signed in'}</span>
        </div>
        <div className="form__field">
          <span className="form__label">tier</span>
          <span style={{ fontSize: 'var(--type-ui)' }}>Free</span>
        </div>
        <p className="form__hint" style={{ margin: 0 }}>
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

function ClerkProfilePill({ compact }: { readonly compact: boolean }): JSX.Element {
  const { user, isLoaded } = useUser();
  const { sessionClaims } = useAuth();
  const clerk = useClerk();
  const { prefs, update } = usePrefs();
  const [profileOpen, setProfileOpen] = useState(false);

  const signedIn = !!user;

  // Persist the resolved Clerk identity into desktop prefs on a fresh
  // sign-in (the old AuthStep did this during onboarding). Gated on the id
  // actually changing so we don't rewrite `signedInAt` on every launch.
  // Mirrors the sign-out clear in ProfileView.
  useEffect(() => {
    if (!user) return;
    if (prefs?.clerkUserId === user.id) return;
    void update({
      clerkUserId: user.id,
      clerkDisplayName:
        user.fullName ??
        user.primaryEmailAddress?.emailAddress ??
        user.username ??
        null,
      signedInAt: Date.now(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, prefs?.clerkUserId]);

  // Treat a prior on-disk identity as "signed in" while Clerk is still
  // loading so returning users don't flash a "Sign in" prompt on launch.
  const showProfile = signedIn || (!isLoaded && !!prefs?.clerkUserId);
  const primaryEmail = user?.primaryEmailAddress;
  const displayName =
    user?.fullName ??
    primaryEmail?.emailAddress ??
    user?.username ??
    prefs?.clerkDisplayName ??
    'Account';
  // Account tier — try every place a client legitimately can read it:
  //   1. publicMetadata.accountType         (server-set, client-readable)
  //   2. session-token claim "accountType"  (recommended for private
  //      data — configure under Sessions → Customize session token)
  //   3. unsafeMetadata.accountType         (client-writable, last resort)
  // privateMetadata is server-only by Clerk's design and never reaches
  // the renderer.
  const claims = (sessionClaims ?? {}) as Record<string, unknown>;
  const publicMeta = user?.publicMetadata as Record<string, unknown> | undefined;
  const unsafeMeta = user?.unsafeMetadata as Record<string, unknown> | undefined;
  const tier = formatTier(
    publicMeta?.accountType ??
      claims['accountType'] ??
      claims['account_type'] ??
      unsafeMeta?.accountType,
  );
  // Single-line profile row, no background — a top border separates it
  // from the workspace list above. Signed-out reads as a sign-in prompt;
  // there is no "Guest" middle state.
  if (compact) {
    return (
      <>
        {!showProfile ? (
          <AvatarTile
            label={null}
            title="Sign in"
            onClick={() =>
              void clerk.openSignIn({ fallbackRedirectUrl: '/', signUpFallbackRedirectUrl: '/' })
            }
          />
        ) : (
          <AvatarTile
            label={initialsOf(displayName)}
            title={`${displayName} · ${tier} · click for account`}
            onClick={() => setProfileOpen(true)}
          />
        )}
        {profileOpen && signedIn && (
          <ProfileView tier={tier} onClose={() => setProfileOpen(false)} />
        )}
      </>
    );
  }

  const row =
    !showProfile ? (
      <button
        type="button"
        className="row-button"
        // Explicit redirect targets, mirroring the ClerkProvider fallback
        // props: keep the post-OAuth landing on the app's own origin so the
        // FAPI never falls back to the hosted Account Portal.
        onClick={() =>
          void clerk.openSignIn({ fallbackRedirectUrl: '/', signUpFallbackRedirectUrl: '/' })
        }
        style={profileRowStyle('var(--color-primary-strong)')}
      >
        <Icon name="agent" size={14} style={{ flexShrink: 0 }} />
        <span style={profileLabelStyle('var(--color-primary-strong)')}>Sign in</span>
        <Icon name="chevron-right" size={14} style={{ flexShrink: 0 }} />
      </button>
    ) : (
      <button
        type="button"
        className="row-button"
        onClick={() => setProfileOpen(true)}
        title={`${displayName} · click for account`}
        style={profileRowStyle('var(--color-sidebar-text)')}
      >
        <span style={profileLabelStyle('var(--color-sidebar-text)')}>{displayName}</span>
        {!isLoaded ? (
          <span style={{ fontSize: 'var(--type-label)', color: 'var(--color-sidebar-text-dim)', flexShrink: 0 }}>…</span>
        ) : (
          <span style={tierBadgeStyle(tier)}>{tier}</span>
        )}
        <Icon
          name="chevron-right"
          size={13}
          style={{ color: 'var(--color-sidebar-text-dim)', flexShrink: 0 }}
        />
      </button>
    );

  return (
    <div style={{ borderTop: '1px solid var(--color-sidebar-border)', padding: '6px 6px 8px' }}>
      {row}
      {profileOpen && signedIn && (
        <ProfileView tier={tier} onClose={() => setProfileOpen(false)} />
      )}
    </div>
  );
}

// ---- tier helpers ----

/** Format an accountType value for display. Free-tier is the default
 *  when the publicMetadata field is missing. */
function formatTier(raw: unknown): string {
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const t = raw.trim().toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  return 'Free';
}

/** Tier-coloured pill. Free is intentionally calm — a slate chip on
 *  the dark sidebar reads as "default, no upsell." Paid tiers get the
 *  brand pink + gradient so an upgrade visibly changes the badge. */
function tierBadgeStyle(tier: string): React.CSSProperties {
  const isFree = tier.toLowerCase() === 'free';
  return {
    padding: '1px 7px',
    borderRadius: 'var(--radius-pill)',
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    fontSize: 'var(--type-label)',
    background: isFree
      ? 'color-mix(in srgb, var(--color-text-dim) 16%, transparent)'
      : 'var(--color-primary)',
    color: isFree ? 'var(--color-sidebar-text)' : '#fff',
    border: isFree
      ? '1px solid color-mix(in srgb, var(--color-text-dim) 28%, transparent)'
      : 'none',
  };
}

// ---- row styles ----

function profileRowStyle(color: string): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    margin: 0,
    padding: '8px 10px',
    background: 'transparent',
    border: 'none',
    borderRadius: 'var(--radius-block)',
    color,
    textAlign: 'left',
  };
}

function profileLabelStyle(color: string): React.CSSProperties {
  return {
    flex: 1,
    minWidth: 0,
    fontSize: 'var(--type-ui)',
    fontWeight: 600,
    color,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };
}
