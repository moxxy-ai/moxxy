/**
 * completeDanglingOAuthTransfer:
 *   1. New-user OAuth sign-in left `transferable` on the client → the sweep
 *      creates the account (signUp.create transfer) and activates the session.
 *   2. Mirror case: sign-up against an existing external account → signs in.
 *   3. Clean clients / unrelated verification states are untouched.
 *   4. Non-complete transfers and thrown API errors never activate a session
 *      (and never throw — the sign-in modal stays the fallback UI).
 */

import { describe, expect, it, vi } from 'vitest';
import {
  completeDanglingOAuthTransfer,
  type TransferClerkLike,
} from './oauthTransfer';

type Verification = { status: string | null; error?: { code?: string } | null };

function fakeClerk(opts: {
  signInVerification?: Verification;
  signUpVerification?: Verification;
  signUpCreate?: () => Promise<{ status: string | null; createdSessionId: string | null }>;
  signInCreate?: () => Promise<{ status: string | null; createdSessionId: string | null }>;
  client?: null;
}) {
  const signUpCreate = vi.fn(
    opts.signUpCreate ?? (() => Promise.resolve({ status: 'complete', createdSessionId: 'sess_up' })),
  );
  const signInCreate = vi.fn(
    opts.signInCreate ?? (() => Promise.resolve({ status: 'complete', createdSessionId: 'sess_in' })),
  );
  const setActive = vi.fn(() => Promise.resolve());
  const clerk: TransferClerkLike = {
    client:
      opts.client === null
        ? null
        : {
            signIn: {
              firstFactorVerification: opts.signInVerification ?? { status: null },
              create: signInCreate,
            },
            signUp: {
              verifications: {
                externalAccount: opts.signUpVerification ?? { status: null },
              },
              create: signUpCreate,
            },
          },
    setActive,
  };
  return { clerk, signUpCreate, signInCreate, setActive };
}

const NOT_FOUND: Verification = {
  status: 'transferable',
  error: { code: 'external_account_not_found' },
};
const EXISTS: Verification = {
  status: 'transferable',
  error: { code: 'external_account_exists' },
};

describe('completeDanglingOAuthTransfer', () => {
  it('creates the account + signs in when a new-user sign-in attempt dangles', async () => {
    const { clerk, signUpCreate, signInCreate, setActive } = fakeClerk({
      signInVerification: NOT_FOUND,
    });
    await expect(completeDanglingOAuthTransfer(clerk)).resolves.toBe('signed-in');
    expect(signUpCreate).toHaveBeenCalledWith({ transfer: true });
    expect(signInCreate).not.toHaveBeenCalled();
    expect(setActive).toHaveBeenCalledWith({ session: 'sess_up' });
  });

  it('signs in when a sign-up attempt dangles against an existing account', async () => {
    const { clerk, signUpCreate, signInCreate, setActive } = fakeClerk({
      signUpVerification: EXISTS,
    });
    await expect(completeDanglingOAuthTransfer(clerk)).resolves.toBe('signed-in');
    expect(signInCreate).toHaveBeenCalledWith({ transfer: true });
    expect(signUpCreate).not.toHaveBeenCalled();
    expect(setActive).toHaveBeenCalledWith({ session: 'sess_in' });
  });

  it('does nothing on a clean client', async () => {
    const { clerk, signUpCreate, signInCreate, setActive } = fakeClerk({});
    await expect(completeDanglingOAuthTransfer(clerk)).resolves.toBe('none');
    expect(signUpCreate).not.toHaveBeenCalled();
    expect(signInCreate).not.toHaveBeenCalled();
    expect(setActive).not.toHaveBeenCalled();
  });

  it('does nothing without a client, or on unrelated verification states', async () => {
    const noClient = fakeClerk({ client: null });
    await expect(completeDanglingOAuthTransfer(noClient.clerk)).resolves.toBe('none');

    // transferable status but a different error code — not a transfer case
    const wrongCode = fakeClerk({
      signInVerification: { status: 'transferable', error: { code: 'user_locked' } },
    });
    await expect(completeDanglingOAuthTransfer(wrongCode.clerk)).resolves.toBe('none');

    // right code but a settled (failed) verification — nothing to transfer
    const settled = fakeClerk({
      signInVerification: { status: 'failed', error: { code: 'external_account_not_found' } },
    });
    await expect(completeDanglingOAuthTransfer(settled.clerk)).resolves.toBe('none');
    expect(settled.signUpCreate).not.toHaveBeenCalled();
  });

  it('reports incomplete transfers without activating a session', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { clerk, setActive } = fakeClerk({
      signInVerification: NOT_FOUND,
      signUpCreate: () => Promise.resolve({ status: 'missing_requirements', createdSessionId: null }),
    });
    await expect(completeDanglingOAuthTransfer(clerk)).resolves.toBe('incomplete');
    expect(setActive).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('swallows API errors (the sign-in modal remains the fallback)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { clerk, setActive } = fakeClerk({
      signInVerification: NOT_FOUND,
      signUpCreate: () => Promise.reject(new Error('captcha_invalid')),
    });
    await expect(completeDanglingOAuthTransfer(clerk)).resolves.toBe('failed');
    expect(setActive).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
