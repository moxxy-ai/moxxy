/**
 * Belt-and-braces completion of Clerk's OAuth "transfer" flow.
 *
 * Sign-in with an OAuth account that has no Clerk user behind it cannot
 * complete server-side: Clerk parks the attempt on the client with
 * `firstFactorVerification.status === 'transferable'` and expects client JS
 * to convert it into a sign-up (`signUp.create({ transfer: true })`). In the
 * desktop app that conversion normally happens on the hosted Account
 * Portal's sso-callback page — a leg that has historically been fragile
 * (full-window redirects, the portal-stranding recovery net). If it dies,
 * the user lands back in the app signed OUT with the attempt dangling, and
 * the next sign-in modal greets them with "External account not found".
 *
 * `OAuthTransferBridge` (mounted once inside ClerkProvider) sweeps up that
 * state: on boot, signed out, with a dangling transferable attempt in either
 * direction, it completes the transfer itself and activates the session —
 * so "sign in with no account" always ends signed-up + signed-in.
 *
 * It also renders the `clerk-captcha` mount node: the instance has bot
 * protection enabled, and Clerk's smart captcha needs a DOM element to
 * render into when a sign-up created outside the prebuilt components
 * requires an interactive challenge (without it, clerk-js falls back to an
 * invisible challenge and sign-up can dead-end).
 */

import React from 'react';
import { useAuth, useClerk } from '@clerk/clerk-react';

// Structural slices of the Clerk client so the transfer logic is testable
// without clerk-js. The real resources satisfy these (method params are
// bivariant; status unions widen to string).

interface VerificationLike {
  readonly status: string | null;
  readonly error?: { readonly code?: string } | null;
}

interface TransferAttemptResult {
  readonly status: string | null;
  readonly createdSessionId: string | null;
}

export interface TransferClerkLike {
  readonly client:
    | {
        readonly signIn: {
          readonly firstFactorVerification: VerificationLike;
          create(params: { transfer: boolean }): Promise<TransferAttemptResult>;
        };
        readonly signUp: {
          readonly verifications: { readonly externalAccount: VerificationLike };
          create(params: { transfer: boolean }): Promise<TransferAttemptResult>;
        };
      }
    | null
    | undefined;
  setActive(params: { session: string }): Promise<unknown>;
}

export type TransferOutcome = 'signed-in' | 'none' | 'incomplete' | 'failed';

/**
 * Complete a dangling OAuth transfer, in whichever direction it dangles:
 *  - sign-in attempt against an unknown external account → create the user
 *    (`signUp.create({ transfer: true })`) — the reported desktop bug;
 *  - sign-up attempt against an already-linked external account → sign in
 *    (`signIn.create({ transfer: true })`) — the mirror case, handled the
 *    same way clerk-js's own sso-callback step does.
 * Returns what happened so callers/tests can assert; never throws.
 */
export async function completeDanglingOAuthTransfer(
  clerk: TransferClerkLike,
): Promise<TransferOutcome> {
  const client = clerk.client;
  if (!client) return 'none';

  const signInVerification = client.signIn.firstFactorVerification;
  const needsSignUpTransfer =
    signInVerification.status === 'transferable' &&
    signInVerification.error?.code === 'external_account_not_found';

  const signUpVerification = client.signUp.verifications.externalAccount;
  const needsSignInTransfer =
    signUpVerification.status === 'transferable' &&
    signUpVerification.error?.code === 'external_account_exists';

  if (!needsSignUpTransfer && !needsSignInTransfer) return 'none';

  try {
    const res = needsSignUpTransfer
      ? await client.signUp.create({ transfer: true })
      : await client.signIn.create({ transfer: true });
    if (res.status === 'complete' && res.createdSessionId) {
      await clerk.setActive({ session: res.createdSessionId });
      return 'signed-in';
    }
    // e.g. missing_requirements / needs_second_factor — leave it to the
    // sign-in modal, which resumes the attempt with its full UI.
    console.warn(`[oauth-transfer] transfer did not complete (status: ${res.status})`);
    return 'incomplete';
  } catch (err) {
    console.warn('[oauth-transfer] transfer failed', err);
    return 'failed';
  }
}

/** Mounted once inside ClerkProvider (see main.tsx). */
export function OAuthTransferBridge(): React.ReactElement {
  const clerk = useClerk();
  const { isLoaded, isSignedIn } = useAuth();
  // One sweep per app load: the dangling state we target only ever exists
  // right after a (reload-inducing) OAuth round-trip.
  const attempted = React.useRef(false);

  React.useEffect(() => {
    if (!isLoaded || isSignedIn || attempted.current) return;
    attempted.current = true;
    void completeDanglingOAuthTransfer(clerk as unknown as TransferClerkLike);
  }, [isLoaded, isSignedIn, clerk]);

  // Captcha mount node — empty (and invisible) until clerk-js needs to show
  // an interactive challenge; pinned above the modal overlay if it does.
  return (
    <div
      id="clerk-captcha"
      style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 10_000 }}
    />
  );
}
