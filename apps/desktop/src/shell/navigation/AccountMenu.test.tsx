import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { View } from '../views';
import { usePopover } from '../menu/usePopover';
import { AccountMenu, type AccountSummary } from './AccountMenu';
import { DESTINATIONS, RUNNER_LOCKED_REASON, type DestinationId } from './destinations';

/**
 * The account menu is where every place outside the conversation lives now that
 * the rail is gone. Hiding navigation behind one control only works if that
 * control lists everything, so what is pinned here is reachability.
 */

const SIGNED_IN: AccountSummary = { name: 'Alex Chen', initials: 'AC', tier: 'Free', signedIn: true };
const SIGNED_OUT: AccountSummary = { name: null, initials: null, tier: 'Free', signedIn: false };

function Harness({
  view = 'chat',
  account = SIGNED_IN,
  locked = [],
  onPick = vi.fn(),
  onAccount = vi.fn(),
  onShortcuts = vi.fn(),
  onPalette = vi.fn(),
}: {
  readonly view?: View;
  readonly account?: AccountSummary;
  readonly locked?: ReadonlyArray<DestinationId>;
  readonly onPick?: (id: DestinationId) => void;
  readonly onAccount?: () => void;
  readonly onShortcuts?: () => void;
  readonly onPalette?: () => void;
}): JSX.Element {
  const popover = usePopover<HTMLButtonElement, HTMLDivElement>({ side: 'top', align: 'start', width: 248 });
  return (
    <AccountMenu
      popover={popover}
      account={account}
      view={view}
      isDisabled={(id) => locked.includes(id)}
      disabledReason={RUNNER_LOCKED_REASON}
      onPick={onPick}
      onAccount={onAccount}
      onShortcuts={onShortcuts}
      onPalette={onPalette}
    />
  );
}

const trigger = (): HTMLElement => screen.getByTestId('account-menu-trigger');
/** A pointer click. jsdom's default click carries `detail: 0`, which is what a
 *  keyboard activation looks like in a browser. */
const pointerOpen = (): boolean => fireEvent.click(trigger(), { detail: 1 });

describe('AccountMenu', () => {
  it('stays out of the way until asked: closed, it is one row naming the account', () => {
    render(<Harness />);
    expect(trigger()).toHaveTextContent('Alex Chen');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();
    for (const d of DESTINATIONS) expect(screen.queryByTestId(`nav-${d.id}`)).toBeNull();
  });

  it('lists every place the app has, by name', () => {
    render(<Harness />);
    pointerOpen();
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    for (const d of DESTINATIONS) {
      expect(screen.getByTestId(`nav-${d.id}`), `nav-${d.id} missing`).toHaveTextContent(d.label);
    }
    expect(screen.getByTestId('nav-account')).toHaveTextContent('Account');
    expect(screen.getByTestId('nav-shortcuts')).toHaveTextContent('Keyboard shortcuts');
  });

  it('names the palette and its shortcut, so the fast way in is discoverable', () => {
    const onPalette = vi.fn();
    render(<Harness onPalette={onPalette} />);
    pointerOpen();
    const item = screen.getByTestId('nav-palette');
    expect(item).toHaveTextContent('Command palette');
    expect(item.textContent).toMatch(/⌘K|Ctrl\+K/);
    fireEvent.click(item);
    expect(onPalette).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('marks exactly one place as current, and it is the view on screen', () => {
    render(<Harness view="automations" />);
    pointerOpen();
    const current = DESTINATIONS.filter(
      (d) => screen.getByTestId(`nav-${d.id}`).getAttribute('aria-current') === 'page',
    );
    expect(current.map((d) => d.id)).toEqual(['automations']);
  });

  it('goes there on click and gets out of the way', () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    pointerOpen();
    fireEvent.click(screen.getByTestId('nav-channels'));
    expect(onPick).toHaveBeenCalledWith('channels');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('does not go to a place that needs a loaded session, and says why', () => {
    const onPick = vi.fn();
    render(<Harness locked={['automations']} onPick={onPick} />);
    pointerOpen();
    const locked = screen.getByTestId('nav-automations');
    expect(locked).toBeDisabled();
    expect(locked).toHaveAttribute('data-tip', RUNNER_LOCKED_REASON);
    fireEvent.click(locked);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('opens the account, and offers sign-in when nobody is signed in', () => {
    const onAccount = vi.fn();
    const { unmount } = render(<Harness onAccount={onAccount} />);
    pointerOpen();
    fireEvent.click(screen.getByTestId('nav-account'));
    expect(onAccount).toHaveBeenCalledOnce();
    unmount();

    render(<Harness account={SIGNED_OUT} />);
    expect(trigger()).toHaveTextContent('Sign in');
    pointerOpen();
    expect(screen.getByTestId('nav-account')).toHaveTextContent('Sign in');
  });

  it('is a keyboard menu: focus moves in, arrows move, Escape returns to the row', () => {
    render(<Harness />);
    trigger().focus();
    fireEvent.click(trigger());
    const first = screen.getByTestId('nav-account');
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('nav-chat'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('closes when the pointer goes down anywhere else', () => {
    render(<Harness />);
    pointerOpen();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('grows from its row for a pointer, and simply appears for the keyboard', () => {
    render(<Harness />);
    pointerOpen();
    const menu = screen.getByRole('menu');
    expect(menu).not.toHaveAttribute('data-instant');
    // Above the row, so it grows from its own bottom-left corner.
    expect(menu.style.transformOrigin).toBe('bottom left');
    fireEvent.keyDown(document, { key: 'Escape' });

    fireEvent.click(trigger());
    expect(screen.getByRole('menu')).toHaveAttribute('data-instant', 'true');
  });
});
