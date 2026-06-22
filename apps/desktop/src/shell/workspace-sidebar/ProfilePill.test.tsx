import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ProfilePill } from './ProfilePill';

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
  it('renders without Clerk hooks when no publishable key is configured', () => {
    render(<ProfilePill />);

    expect(screen.getByText('Sign in')).toBeTruthy();
  });
});
