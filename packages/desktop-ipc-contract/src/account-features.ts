/** Slugs under Clerk Billing → Features. Plan names and prices can change independently. */
export type PersonalFeature = 'local_assistant' | 'model_connections' | 'device_key_sync';

export interface BillingClaims {
  readonly fea?: unknown;
  readonly pla?: unknown;
}

/** Evaluate a Clerk session's personal entitlements. The caller authenticates the session. */
export function hasPersonalFeature(claims: BillingClaims, feature: PersonalFeature): boolean {
  if (typeof claims.fea !== 'string') return false;
  return claims.fea.split(',').some(entry => {
    const item = entry.trim();
    return item === `u:${feature}` || item === `ou:${feature}` || item === `uo:${feature}`;
  });
}

/** Only device sync predates Billing. An unbilled session can still use it on an unbilled instance. */
export function hasNoBillingClaims(claims: BillingClaims): boolean {
  return (claims.fea == null || claims.fea === '') && (claims.pla == null || claims.pla === '');
}
