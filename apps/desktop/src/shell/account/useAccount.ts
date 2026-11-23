import { useState } from 'react';
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
  const [profileId, setProfileId] = useState<string | null>(null);
  const name = user ? user.fullName ?? user.primaryEmailAddress?.emailAddress ?? user.username ?? 'Account' : null;
  const claims = (sessionClaims ?? {}) as Record<string, unknown>;
  const tier = formatTier(user?.publicMetadata['accountType'] ?? claims['accountType'] ?? claims['account_type']);

  return {
    summary: summarize(name, tier),
    open: () => {
      if (!isLoaded) return;
      if (user) setProfileId(user.id);
      // Explicit redirect targets keep the post-OAuth landing on the app's own
      // origin, so Clerk never falls back to the hosted Account Portal.
      else void clerk.openSignIn({ fallbackRedirectUrl: '/', signUpFallbackRedirectUrl: '/' });
    },
    panel: user && profileId === user.id ? 'profile' : 'none',
    closePanel: () => setProfileId(null),
  };
}

/**
 * Who is signed in, and how to open their account. The key is fixed for a
 * build, so which hook this is never changes between renders.
 */
export const useAccount: () => Account = HAS_CLERK_KEY ? useClerkAccount : useLocalAccount;
