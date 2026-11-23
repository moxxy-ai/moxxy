import { Button } from '@moxxy/desktop-ui';
import { useAccount } from '../shell/account/useAccount';
import { ProfileView } from '../shell/ProfileView';

export function SetupAccount(): JSX.Element {
  const account = useAccount();
  const syncEnabled = Boolean(import.meta.env.VITE_ACCOUNT_SYNC_URL?.trim());
  const label = account.summary.signedIn
    ? (syncEnabled ? 'Account and device sync' : 'Account')
    : (syncEnabled ? 'Sign in to restore a device' : 'Sign in');
  return <>
    <Button variant="secondary" onClick={account.open}>
      {label}
    </Button>
    {account.panel === 'profile' && <ProfileView tier={account.summary.tier} onClose={account.closePanel} />}
  </>;
}
