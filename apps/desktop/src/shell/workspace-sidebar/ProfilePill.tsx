import { useEffect, useState } from 'react';
import { useAuth, useClerk, useUser } from '@clerk/clerk-react';
import { Icon } from '@moxxy/desktop-ui';
import { usePrefs } from '@moxxy/client-core';
import { ProfileView } from '../ProfileView';
import type { View } from '../ViewHeader';

/**
 * Bottom-of-rail profile row (z.ai style): avatar + display name + a settings
 * gear. Doubles as a presence indicator: signed-out renders a "Sign in" prompt
 * that opens Clerk's own modal (`clerk.openSignIn()` — the only sign-in entry
 * point); signed-in shows the name + tier badge and opens the full account view
 * on click. The gear is the sole Settings destination now that the standalone
 * sidebar nav entry was folded in. A top border separates it from the list above.
 *
 * In the collapsed icon rail it shrinks to just the avatar + a gear, stacked.
 */
export function ProfilePill({
  view,
  onView,
  collapsed = false,
}: {
  readonly view: View;
  readonly onView: (v: View) => void;
  readonly collapsed?: boolean;
}): JSX.Element {
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
  const avatar = <Avatar imageUrl={user?.imageUrl ?? null} name={displayName} signedIn={showProfile} />;
  const openSignIn = (): void =>
    void clerk.openSignIn({ fallbackRedirectUrl: '/', signUpFallbackRedirectUrl: '/' });
  const settingsActive = view === 'settings';

  // Collapsed rail: just the avatar (opens account / sign-in) + a gear, stacked.
  if (collapsed) {
    return (
      <div
        style={{
          borderTop: '1px solid var(--color-sidebar-border)',
          padding: '8px 0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <button
          type="button"
          className="row-button"
          aria-label={showProfile ? `${displayName} — account` : 'Sign in'}
          title={showProfile ? displayName : 'Sign in'}
          onClick={() => (showProfile ? setProfileOpen(true) : openSignIn())}
          style={{ ...gearBtnStyle(false), width: 36, height: 36 }}
        >
          {avatar}
        </button>
        <button
          type="button"
          className="row-button"
          data-testid="nav-settings"
          data-active={settingsActive}
          aria-label="Settings"
          title="Settings"
          onClick={() => onView('settings')}
          style={gearBtnStyle(settingsActive)}
        >
          <Icon name="settings" size={17} />
        </button>
        {profileOpen && signedIn && (
          <ProfileView tier={tier} onClose={() => setProfileOpen(false)} />
        )}
      </div>
    );
  }

  // Single-line profile row: avatar + name (+ tier) on the left, settings gear
  // on the right. Signed-out reads as a sign-in prompt; no "Guest" middle state.
  const identity = !showProfile ? (
    <button
      type="button"
      className="row-button"
      onClick={openSignIn}
      style={profileRowStyle('var(--color-primary-strong)')}
    >
      {avatar}
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
      {avatar}
      <span style={profileLabelStyle('var(--color-sidebar-text)')}>{displayName}</span>
      {!isLoaded ? (
        <span style={{ fontSize: 10.5, color: 'var(--color-sidebar-text-dim)', flexShrink: 0 }}>…</span>
      ) : (
        <span style={tierBadgeStyle(tier)}>{tier}</span>
      )}
    </button>
  );

  return (
    <div
      style={{
        borderTop: '1px solid var(--color-sidebar-border)',
        padding: '6px 6px 8px',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>{identity}</div>
      <button
        type="button"
        className="row-button"
        data-testid="nav-settings"
        data-active={settingsActive}
        aria-label="Settings"
        title="Settings"
        onClick={() => onView('settings')}
        style={gearBtnStyle(settingsActive)}
      >
        <Icon name="settings" size={17} />
      </button>
      {profileOpen && signedIn && (
        <ProfileView tier={tier} onClose={() => setProfileOpen(false)} />
      )}
    </div>
  );
}

/** Round avatar — Clerk image if available, else initials, else the agent glyph. */
function Avatar({
  imageUrl,
  name,
  signedIn,
}: {
  readonly imageUrl: string | null;
  readonly name: string;
  readonly signedIn: boolean;
}): JSX.Element {
  const base: React.CSSProperties = {
    width: 26,
    height: 26,
    borderRadius: '50%',
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    objectFit: 'cover',
  };
  if (imageUrl) return <img src={imageUrl} alt="" style={base} />;
  const initials = signedIn
    ? name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join('') || name[0]?.toUpperCase() || '?'
    : null;
  return (
    <span
      aria-hidden
      style={{
        ...base,
        background: 'var(--color-sidebar-bg-active)',
        color: 'var(--color-sidebar-text)',
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      {initials ?? <Icon name="agent" size={14} />}
    </span>
  );
}

/** Settings/avatar icon button — grey active wash when on the Settings view. */
function gearBtnStyle(active: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 30,
    height: 30,
    borderRadius: 8,
    flexShrink: 0,
    color: active ? 'var(--color-sidebar-text)' : 'var(--color-sidebar-text-dim)',
    background: active ? 'var(--color-sidebar-bg-active)' : 'transparent',
  };
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
