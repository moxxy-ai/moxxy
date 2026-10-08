import { Icon } from '@moxxy/desktop-ui';
import { chordLabel } from '@/hotkeys/chordLabel';
import { PopoverMenu, type MenuEntry } from '../menu/PopoverMenu';
import type { Popover } from '../menu/usePopover';
import type { View } from '../views';
import { DESTINATIONS, type Destination, type DestinationId } from './destinations';

/** Who the account row shows. `name` is null when nobody is signed in. */
export interface AccountSummary {
  readonly name: string | null;
  readonly initials: string | null;
  readonly tier: string;
  readonly signedIn: boolean;
}

/**
 * The account row at the foot of the sidebar, and the menu it opens.
 *
 * This is the app's navigation. The conversation is the main thing on screen,
 * so every other place sits one click away here (and one shortcut away in the
 * palette) instead of in a permanent rail.
 */
export function AccountMenu({
  popover,
  account,
  view,
  isDisabled,
  disabledReason,
  onPick,
  onAccount,
  onPalette,
  onShortcuts,
}: {
  readonly popover: Popover<HTMLButtonElement, HTMLDivElement>;
  readonly account: AccountSummary;
  readonly view: View;
  readonly isDisabled: (id: DestinationId) => boolean;
  readonly disabledReason: string;
  readonly onPick: (id: DestinationId) => void;
  readonly onAccount: () => void;
  readonly onPalette: () => void;
  readonly onShortcuts: () => void;
}): JSX.Element {
  const place = (d: Destination): MenuEntry => ({
    id: d.id,
    label: d.label,
    icon: d.icon,
    hint: d.chord ? chordLabel(d.chord) : undefined,
    testId: `nav-${d.id}`,
    current: d.id === view,
    disabled: isDisabled(d.id),
    disabledReason,
    onSelect: () => onPick(d.id),
  });
  const entries: ReadonlyArray<MenuEntry> = [
    {
      id: 'account',
      label: account.signedIn ? 'Account' : 'Sign in',
      icon: 'user',
      testId: 'nav-account',
      onSelect: onAccount,
    },
    'separator',
    ...DESTINATIONS.filter((d) => d.id !== 'settings').map(place),
    'separator',
    ...DESTINATIONS.filter((d) => d.id === 'settings').map(place),
    {
      id: 'palette',
      label: 'Command palette',
      icon: 'search',
      hint: chordLabel('mod+k'),
      testId: 'nav-palette',
      onSelect: onPalette,
    },
    {
      id: 'shortcuts',
      label: 'Keyboard shortcuts',
      icon: 'terminal',
      hint: chordLabel('mod+/'),
      testId: 'nav-shortcuts',
      onSelect: onShortcuts,
    },
  ];

  return (
    <>
      <button
        ref={popover.anchorRef}
        type="button"
        className="account-row"
        data-testid="account-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={popover.open}
        onClick={popover.toggle}
      >
        <span className="account-row__avatar" aria-hidden>
          {account.initials ?? <Icon name="user" size={15} />}
        </span>
        <span className="account-row__text">
          <span className="account-row__name">{account.name ?? 'Sign in'}</span>
          <span className="account-row__meta">
            {account.signedIn ? account.tier : 'Menu and settings'}
          </span>
        </span>
        <span className="account-row__more" aria-hidden>
          <Icon name="more" size={16} />
        </span>
      </button>
      <PopoverMenu popover={popover} label="Menu" entries={entries} />
    </>
  );
}
