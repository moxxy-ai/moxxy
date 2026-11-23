import { usePersonalFeature } from './usePersonalFeature';
import { useState } from 'react';
import { useSession } from '@clerk/react';
import { api, toErrorMessage } from '@moxxy/client-core';
import { isSyncKeyName, keySyncDisabledField } from '@moxxy/desktop-ipc-contract/account-sync';
import { Button, ConfirmModal } from '@moxxy/desktop-ui';

export function KeySyncControl({ name, allowOptOut = false }: { name?: string; allowOptOut?: boolean }): JSX.Element | null {
  if (!import.meta.env.VITE_ACCOUNT_SYNC_URL?.trim() || !import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() ||
      (name !== undefined && !isSyncKeyName(name))) return null;
  return <AccountKeySyncSwitch allowOptOut={allowOptOut} />;
}

function AccountKeySyncSwitch({ allowOptOut }: { allowOptOut: boolean }): JSX.Element | null {
  const { session } = useSession();
  const canSync = usePersonalFeature('device_key_sync');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  if (!session || session.status !== 'active' || session.currentTask || !session.user) return null;
  const user = session.user;
  const enabled = user.publicMetadata[keySyncDisabledField] !== true;
  if (!canSync && !(allowOptOut && enabled)) return null;
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
    {canSync ? <label><input type="checkbox" checked={enabled} disabled={busy}
      onChange={() => enabled ? setConfirm(true) : void change(true)} /> Automatically save API keys to my account</label> : (
      <Button variant="secondary" disabled={busy} onClick={() => setConfirm(true)}>Turn off automatic saving</Button>
    )}
    {error && <p role="alert">{error}</p>}
    {confirm && <ConfirmModal title="Turn off API key sync?"
      message="This removes saved API keys from your account and stops future key uploads across your devices. Keys on your computers stay available."
      confirmLabel="Turn off sync" destructive onCancel={() => setConfirm(false)} onConfirm={() => void change(false)} />}
  </div>;
}
