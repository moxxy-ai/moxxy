import { useEffect, useState } from 'react';
import { useAuth, useClerk, useUser } from '@clerk/clerk-react';
import { usePrefs } from '@moxxy/client-core';
import type { AccountSummary } from '../navigation/AccountMenu';
import { formatTier, initialsOf } from './account-identity';

const HAS_CLERK_KEY = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim());

/** Which account panel is open, if any. */
export type AccountPanel = 'none' | 'local' | 'profile';

export interface Account {
  readonly summary: AccountSummary;
  /** Open the account: the profile when signed in, sign-in otherwise. */
  readonly open: () => void;
  readonly panel: AccountPanel;
  readonly closePanel: () => void;
}

function summarize(name: string | null, tier: string): AccountSummary {
  return { name, initials: name ? initialsOf(name) : null, tier, signedIn: name !== null };
}

/** A build without a Clerk key: the identity is whatever this machine stored. */
function useLocalAccount(): Account {
  const { prefs } = usePrefs();
  const [open, setOpen] = useState(false);
  return {
    summary: summarize(prefs?.clerkDisplayName ?? null, 'Free'),
    open: () => setOpen(true),
    panel: open ? 'local' : 'none',
    closePanel: () => setOpen(false),
  };
}

function useClerkAccount(): Account {
  const { user, isLoaded } = useUser();
  const { sessionClaims } = useAuth();
  const clerk = useClerk();
  const { prefs, update } = usePrefs();
  const [profileOpen, setProfileOpen] = useState(false);
  const storedUserId = prefs?.clerkUserId ?? null;

  // Persist the Clerk identity on a fresh sign-in. Gated on the id changing so
  // `signedInAt` is not rewritten on every launch. ProfileView clears it.
  useEffect(() => {
    if (!user || storedUserId === user.id) return;
    const email = user.primaryEmailAddress;
    void update({
      clerkUserId: user.id,
      clerkDisplayName: user.fullName ?? email?.emailAddress ?? user.username ?? null,
      signedInAt: Date.now(),
    });
  }, [user, storedUserId, update]);

  // A stored identity counts as signed in while Clerk loads, so a returning
  // user does not see a sign-in prompt flash on launch.
  const showProfile = user !== null && user !== undefined ? true : !isLoaded && storedUserId !== null;
  const email = user ? user.primaryEmailAddress : null;
  const name =
    (user ? user.fullName : null) ??
    (email ? email.emailAddress : null) ??
    (user ? user.username : null) ??
    prefs?.clerkDisplayName ??
    'Account';

  // The tier, from every place a client may read it: public metadata, a
  // session-token claim, then unsafe metadata. Private metadata never reaches
  // the renderer.
  const claims = (sessionClaims ?? {}) as Record<string, unknown>;
  const publicMeta = (user ? user.publicMetadata : {}) as Record<string, unknown>;
  const unsafeMeta = (user ? user.unsafeMetadata : {}) as Record<string, unknown>;
  const tier = formatTier(
    publicMeta['accountType'] ??
      claims['accountType'] ??
      claims['account_type'] ??
      unsafeMeta['accountType'],
  );

  return {
    summary: summarize(showProfile ? name : null, tier),
    open: () => {
      if (user) setProfileOpen(true);
      // Explicit redirect targets keep the post-OAuth landing on the app's own
      // origin, so Clerk never falls back to the hosted Account Portal.
      else void clerk.openSignIn({ fallbackRedirectUrl: '/', signUpFallbackRedirectUrl: '/' });
    },
    panel: profileOpen && user ? 'profile' : 'none',
    closePanel: () => setProfileOpen(false),
  };
}

/**
 * Who is signed in, and how to open their account. The key is fixed for a
 * build, so which hook this is never changes between renders.
 */
export const useAccount: () => Account = HAS_CLERK_KEY ? useClerkAccount : useLocalAccount;
