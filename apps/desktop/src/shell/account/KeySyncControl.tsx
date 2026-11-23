import { useState } from 'react';
import { useSession } from '@clerk/clerk-react';
import { api, toErrorMessage } from '@moxxy/client-core';
import { isSyncKeyName, keySyncDisabledField } from '@moxxy/desktop-ipc-contract/account-sync';
import { ConfirmModal } from '@moxxy/desktop-ui';

export function KeySyncControl({ name }: { name?: string }): JSX.Element | null {
  if (!import.meta.env.VITE_ACCOUNT_SYNC_URL?.trim() || !import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() ||
      (name !== undefined && !isSyncKeyName(name))) return null;
  return <AccountKeySyncSwitch />;
}

function AccountKeySyncSwitch(): JSX.Element | null {
  const { session } = useSession();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  if (!session || session.status !== 'active' || session.currentTask || !session.user) return null;
  const user = session.user;
  const enabled = user.publicMetadata[keySyncDisabledField] !== true;
  async function change(next: boolean): Promise<void> {
    setConfirm(false);
    setBusy(true);
    setError('');
    try {
      const token = await session?.getToken({ skipCache: true });
      if (!token) throw new Error('Sign in again to change key sync.');
      await api().invoke('account.setKeySync', { enabled: next, token });
      await user.reload();
    } catch (reason) { setError(toErrorMessage(reason)); }
    finally { setBusy(false); }
  }
  return <div>
    <label><input type="checkbox" checked={enabled} disabled={busy}
      onChange={() => enabled ? setConfirm(true) : void change(true)} /> Automatically save API keys to my account</label>
    {error && <p role="alert">{error}</p>}
    {confirm && <ConfirmModal title="Turn off API key sync?"
      message="This removes saved API keys from your account and stops future key uploads across your devices. Keys on your computers stay available."
      confirmLabel="Turn off sync" destructive onCancel={() => setConfirm(false)} onConfirm={() => void change(false)} />}
  </div>;
}
