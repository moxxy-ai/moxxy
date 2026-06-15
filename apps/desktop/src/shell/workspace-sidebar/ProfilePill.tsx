import { useEffect, useState } from 'react';
import { useAuth, useClerk, useUser } from '@clerk/clerk-react';
import { Icon } from '@moxxy/desktop-ui';
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
export function ProfilePill(): JSX.Element {
  return HAS_CLERK_KEY ? <ClerkProfilePill /> : <KeylessProfilePill />;
}

function KeylessProfilePill(): JSX.Element {
  const { prefs } = usePrefs();
  const displayName = prefs?.clerkDisplayName ?? null;
  const row = displayName ? (
    <button
      type="button"
      className="row-button"
      disabled
      title={displayName}
      style={profileRowStyle('var(--color-sidebar-text)')}
    >
      <span style={profileLabelStyle('var(--color-sidebar-text)')}>{displayName}</span>
      <span style={tierBadgeStyle('Free')}>Free</span>
    </button>
  ) : (
    <button
      type="button"
      className="row-button"
      disabled
      style={profileRowStyle('var(--color-primary-strong)')}
    >
      <Icon name="agent" size={14} style={{ flexShrink: 0 }} />
      <span style={profileLabelStyle('var(--color-primary-strong)')}>Sign in</span>
      <Icon name="chevron-right" size={14} style={{ flexShrink: 0 }} />
    </button>
  );

  return (
    <div style={{ borderTop: '1px solid var(--color-sidebar-border)', padding: '6px 6px 8px' }}>
      {row}
    </div>
  );
}

function ClerkProfilePill(): JSX.Element {
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
  const displayName =
    user?.fullName ??
    user?.primaryEmailAddress?.emailAddress ??
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
  const tier = formatTier(
    (user?.publicMetadata as Record<string, unknown> | undefined)?.accountType ??
      claims['accountType'] ??
      claims['account_type'] ??
      (user?.unsafeMetadata as Record<string, unknown> | undefined)?.accountType,
  );
  // Single-line profile row, no background — a top border separates it
  // from the workspace list above. Signed-out reads as a sign-in prompt;
  // there is no "Guest" middle state.
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
          <span style={{ fontSize: 10.5, color: 'var(--color-sidebar-text-dim)', flexShrink: 0 }}>…</span>
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
    borderRadius: 999,
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    fontSize: 9.5,
    background: isFree
      ? 'color-mix(in srgb, var(--color-text-dim) 16%, transparent)'
      : 'linear-gradient(135deg, rgba(236, 72, 153, 0.85), rgba(217, 70, 239, 0.85))',
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
    borderRadius: 10,
    color,
    textAlign: 'left',
  };
}

function profileLabelStyle(color: string): React.CSSProperties {
  return {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: 600,
    color,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };
}
