import { render, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { AccountIdentityBridge } from './AccountIdentityBridge';

const { auth, invoke } = vi.hoisted(() => ({
  auth: { isLoaded: false, user: null as { id: string; fullName: string } | null },
  invoke: vi.fn(),
}));
vi.mock('@clerk/clerk-react', () => ({ useUser: () => auth }));
vi.mock('@moxxy/client-core', () => ({ api: () => ({ invoke }) }));

it('waits for Clerk and reconciles expiry, new sign-in and a same-account rename', async () => {
  const prefs = { clerkUserId: 'old', clerkDisplayName: 'Old name', signedInAt: 123 };
  invoke.mockImplementation(async (method, patch) => {
    if (method === 'prefs.update') Object.assign(prefs, patch);
    return prefs;
  });
  const tree = render(<AccountIdentityBridge />);
  expect(invoke).not.toHaveBeenCalled();
  auth.isLoaded = true;
  tree.rerender(<AccountIdentityBridge />);
  await waitFor(() => expect(prefs).toEqual({ clerkUserId: null, clerkDisplayName: null, signedInAt: null }));
  auth.user = { id: 'new', fullName: 'Alex' };
  tree.rerender(<AccountIdentityBridge />);
  await waitFor(() => expect(prefs.clerkDisplayName).toBe('Alex'));
  const signedInAt = prefs.signedInAt;
  auth.user = { id: 'new', fullName: 'Taylor' };
  tree.rerender(<AccountIdentityBridge />);
  await waitFor(() => expect(prefs.clerkDisplayName).toBe('Taylor'));
  expect(prefs.signedInAt).toBe(signedInAt);
});
