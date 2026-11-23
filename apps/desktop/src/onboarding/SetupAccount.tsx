import { Button } from '@moxxy/desktop-ui';
import { useAccount } from '../shell/account/useAccount';
import { ProfileView } from '../shell/ProfileView';

export function SetupAccount(): JSX.Element {
  const account = useAccount();
  return <>
    <Button variant="secondary" onClick={account.open}>
      {account.summary.signedIn ? 'Account and device sync' : 'Sign in to restore a device'}
    </Button>
    {account.panel === 'profile' && <ProfileView tier={account.summary.tier} onClose={account.closePanel} />}
  </>;
}
