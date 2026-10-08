import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';

// A guard, not a stand-in: a build without a publishable key has no
// ClerkProvider, so reaching any of these would throw in the real app too.
vi.mock('@clerk/clerk-react', () => {
  const fail = (): never => {
    throw new Error('Clerk hook should not be called without a publishable key');
  };
  return { useUser: fail, useAuth: fail, useClerk: fail };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** The key is read once at module load, so pin it and import afresh; otherwise a
 *  developer's local `.env` decides which branch this suite exercises. */
async function load(prefs: Record<string, unknown>) {
  vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', '');
  vi.resetModules();
  const core = await import('@moxxy/client-core');
  core.__setApiOverride({
    invoke: vi.fn(async (command: string) => (command === 'prefs.read' ? prefs : null)),
    subscribe: () => () => undefined,
  } as unknown as MoxxyApi);
  const { SidebarAccount } = await import('./SidebarAccount');
  const { ShellNavProvider } = await import('../navigation/ShellNav');
  return { SidebarAccount, ShellNavProvider, core };
}

const NAV = {
  view: 'chat' as const,
  go: vi.fn(),
  isDisabled: () => false,
  disabledReason: '',
  showShortcuts: vi.fn(),
  openPalette: vi.fn(),
};

describe('SidebarAccount without a Clerk key', () => {
  it('offers sign-in without touching Clerk, and explains why it cannot', async () => {
    const { SidebarAccount, ShellNavProvider, core } = await load({});
    render(
      <ShellNavProvider value={NAV}>
        <SidebarAccount />
      </ShellNavProvider>,
    );
    const trigger = screen.getByTestId('account-menu-trigger');
    expect(trigger).toHaveTextContent('Sign in');
    fireEvent.click(trigger, { detail: 1 });
    fireEvent.click(screen.getByTestId('nav-account'));
    expect(screen.getByRole('dialog', { name: 'Account' })).toHaveTextContent(
      /no Clerk publishable key/,
    );
    core.__setApiOverride(null);
  });

  it('shows the identity this machine stored', async () => {
    const { SidebarAccount, ShellNavProvider, core } = await load({ clerkDisplayName: 'Alex Chen' });
    render(
      <ShellNavProvider value={NAV}>
        <SidebarAccount />
      </ShellNavProvider>,
    );
    const trigger = await screen.findByText('Alex Chen');
    expect(trigger).toBeTruthy();
    expect(screen.getByTestId('account-menu-trigger')).toHaveTextContent('AC');
    core.__setApiOverride(null);
  });
});
