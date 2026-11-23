import { KeySyncControl } from './KeySyncControl';
import { useState } from 'react';
import { useAuth, useUser } from '@clerk/react';
import { api, toErrorMessage } from '@moxxy/client-core';
import { Button, ConfirmModal } from '@moxxy/desktop-ui';
import { keySyncDisabledField, type SyncAction } from '@moxxy/desktop-ipc-contract/account-sync';

const details: Record<SyncAction, string> = {
  save: 'Copy supported API keys and preferences from this computer to your account? This replaces matching values in the account. Only save keys you own.',
  restore: 'Install the saved API keys and preferences on this computer? Matching local values will be replaced. Keys remain in its vault after you sign out.',
  clear: 'Delete the saved API keys and preferences from your account? Devices keep their local copies.',
};

export function DeviceSync(): JSX.Element {
  const { user } = useUser();
  const keySyncOff = user?.publicMetadata[keySyncDisabledField] === true;
  const { getToken } = useAuth();
  const [action, setAction] = useState<SyncAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function sync(choice: SyncAction): Promise<void> {
    setAction(null);
    setBusy(true);
    try {
      const token = await getToken({ skipCache: true });
      if (!token) throw new Error('Sign in again to sync.');
      const count = await api().invoke('account.sync', { action: choice, token });
      setMessage(choice === 'clear' ? 'Account backup removed.' : choice === 'restore'
        ? `Restored ${count} API key${count === 1 ? '' : 's'} and preferences. Reopen Moxxy to apply all preferences.`
        : `Saved ${count} API key${count === 1 ? '' : 's'} and preferences.`);
    } catch (err) {
      setMessage(toErrorMessage(err));
    } finally { setBusy(false); }
  }
  return <section aria-label="Device sync">
    <strong>Device sync</strong>
    <KeySyncControl />
    <p className="form__hint">Copy model and voice API keys, theme, voice engine and notification preferences between your devices.</p>
    <div className="form__acts">
      <Button variant="secondary" disabled={busy || keySyncOff} onClick={() => setAction('save')}>Save to account</Button>
      <Button variant="secondary" disabled={busy} onClick={() => setAction('restore')}>Restore here</Button>
      <Button variant="secondary" disabled={busy} onClick={() => setAction('clear')}>Remove backup</Button>
    </div>
    <p role="status">{busy ? 'Syncing…' : message}</p>
    {action && <ConfirmModal title="Device sync" message={details[action]} confirmLabel="Continue"
      destructive={action === 'clear'} onCancel={() => setAction(null)} onConfirm={() => void sync(action)} />}
  </section>;
}
