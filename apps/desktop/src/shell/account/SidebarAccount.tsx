import { usePopover } from '../menu/usePopover';
import { AccountMenu } from '../navigation/AccountMenu';
import { useShellNav } from '../navigation/ShellNav';
import { ProfileView } from '../ProfileView';
import { LocalAccountView } from './LocalAccountView';
import { useAccount } from './useAccount';

const MENU_WIDTH = 248;

/** The account row, bound to the shell's navigation and the signed-in identity. */
export function SidebarAccount(): JSX.Element | null {
  const nav = useShellNav();
  const account = useAccount();
  const popover = usePopover<HTMLButtonElement, HTMLDivElement>({
    side: 'top',
    align: 'start',
    width: MENU_WIDTH,
  });
  if (!nav) return null;
  return (
    <div className="sidebar-foot">
      <AccountMenu
        popover={popover}
        account={account.summary}
        view={nav.view}
        isDisabled={nav.isDisabled}
        disabledReason={nav.disabledReason}
        onPick={nav.go}
        onAccount={account.open}
        onPalette={nav.openPalette}
        onShortcuts={nav.showShortcuts}
      />
      {account.panel === 'local' && (
        <LocalAccountView name={account.summary.name} onClose={account.closePanel} />
      )}
      {account.panel === 'profile' && (
        <ProfileView tier={account.summary.tier} onClose={account.closePanel} />
      )}
    </div>
  );
}
