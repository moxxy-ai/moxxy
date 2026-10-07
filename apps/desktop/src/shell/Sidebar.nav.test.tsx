import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { reloadSidebarCollapsedFromStorage } from '@/lib/useSidebarCollapsed';
import { IndexColumn } from './IndexColumn';
import { ShellNavProvider, type ShellNav } from './navigation/ShellNav';
import type { View } from './views';

/**
 * The sidebar is one frame whose list changes per view. The frame owns the two
 * things every view needs: the way back to the conversation, and the account
 * row that leads everywhere else.
 */

beforeEach(() => {
  window.localStorage.clear();
  reloadSidebarCollapsedFromStorage();
  // The account row reads the stored identity over the IPC boundary.
  __setApiOverride({
    invoke: vi.fn(async (command: string) =>
      command === 'prefs.read' ? { clerkDisplayName: 'Alex Chen', clerkUserId: null } : null,
    ),
    subscribe: () => () => undefined,
  } as unknown as MoxxyApi);
});
afterEach(() => __setApiOverride(null));

function nav(view: View, go = vi.fn()): ShellNav {
  return {
    view,
    go,
    isDisabled: () => false,
    disabledReason: 'loading',
    showShortcuts: vi.fn(),
    openPalette: vi.fn(),
  };
}

describe('the sidebar frame', () => {
  it('leads back to the runs from any other view', () => {
    const go = vi.fn();
    render(
      <ShellNavProvider value={nav('settings', go)}>
        <IndexColumn title="settings">rows</IndexColumn>
      </ShellNavProvider>,
    );
    fireEvent.click(screen.getByTestId('sidebar-back'));
    expect(go).toHaveBeenCalledWith('chat');
  });

  it('has no way back on the runs themselves: there is nowhere to go back to', () => {
    render(
      <ShellNavProvider value={nav('chat')}>
        <IndexColumn title="runs">rows</IndexColumn>
      </ShellNavProvider>,
    );
    expect(screen.queryByTestId('sidebar-back')).toBeNull();
  });

  it('carries the account row in every view', async () => {
    for (const view of ['chat', 'settings', 'automations'] as const) {
      const { unmount } = render(
        <ShellNavProvider value={nav(view)}>
          <IndexColumn title={view}>rows</IndexColumn>
        </ShellNavProvider>,
      );
      expect(await screen.findByTestId('account-menu-trigger')).toBeTruthy();
      unmount();
    }
  });

  it('still renders as a plain list outside the shell', () => {
    render(<IndexColumn title="runs">rows</IndexColumn>);
    expect(screen.getByTestId('index-column')).toHaveTextContent('rows');
    expect(screen.queryByTestId('account-menu-trigger')).toBeNull();
  });
});
