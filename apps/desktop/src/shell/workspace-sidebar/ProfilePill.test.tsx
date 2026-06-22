import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@moxxy/client-core', () => ({
  usePrefs: () => ({ prefs: null, update: vi.fn() }),
}));

vi.mock('@clerk/clerk-react', () => ({
  useUser: () => {
    throw new Error('Clerk hook should not be called without a publishable key');
  },
  useAuth: () => {
    throw new Error('Clerk hook should not be called without a publishable key');
  },
  useClerk: () => {
    throw new Error('Clerk hook should not be called without a publishable key');
  },
}));

describe('ProfilePill', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('renders without Clerk hooks when no publishable key is configured', async () => {
    // ProfilePill picks the keyless vs Clerk branch from VITE_CLERK_PUBLISHABLE_KEY,
    // read once at module load. Pin it empty and re-import so the module-level
    // const re-evaluates — otherwise a developer's local apps/desktop/.env leaks a
    // real key, flips the component to the Clerk branch, and this test fails only
    // on their machine (not CI).
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', '');
    vi.resetModules();
    const { ProfilePill } = await import('./ProfilePill');

    render(<ProfilePill />);

    expect(screen.getByText('Sign in')).toBeTruthy();
  });
});
