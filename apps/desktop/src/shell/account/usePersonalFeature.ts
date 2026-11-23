import { useAuth } from '@clerk/react';
import { hasNoBillingClaims, hasPersonalFeature, type PersonalFeature } from '@moxxy/desktop-ipc-contract/account-features';

type Auth = ReturnType<typeof useAuth>;

/** The sync service independently verifies whether a claimless session belongs to an unbilled instance. */
export function sessionAllowsFeature(
  { isSignedIn, userId, sessionId, sessionClaims }: Pick<Auth, 'isSignedIn' | 'userId' | 'sessionId' | 'sessionClaims'>,
  feature: PersonalFeature,
): boolean {
  if (!isSignedIn || !userId || !sessionId || !sessionClaims || sessionClaims.sts === 'pending' || sessionClaims.act ||
      sessionClaims.sub !== userId || sessionClaims.sid !== sessionId) return false;
  const billing = { fea: sessionClaims.fea, pla: sessionClaims.pla };
  return hasPersonalFeature(billing, feature) || (feature === 'device_key_sync' && hasNoBillingClaims(billing));
}

function useClerkFeature(feature: PersonalFeature): boolean {
  return sessionAllowsFeature(useAuth(), feature);
}

export const usePersonalFeature: (feature: PersonalFeature) => boolean =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() ? useClerkFeature : () => false;
