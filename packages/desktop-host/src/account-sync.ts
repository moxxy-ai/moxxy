import { accountSnapshot, syncKeyNames, type AccountSnapshot, type SyncAction } from '@moxxy/desktop-ipc-contract/account-sync';
import type { VaultStore } from '@moxxy/plugin-vault';
import { readPrefs, updatePrefs } from './prefs';

export async function syncAccount(
  endpoint: string, token: string, action: SyncAction,
  vault: Pick<VaultStore, 'get' | 'setMany'>, request = fetch,
): Promise<number> {
  let keys: AccountSnapshot['keys'] = {};
  let body: string | undefined;
  if (action === 'save') {
    for (const name of syncKeyNames) {
      const value = await vault.get(name);
      if (value) keys[name] = value;
    }
    const { theme, voiceEngine, replySound, inAppToasts, systemNotifications } = readPrefs();
    body = JSON.stringify(accountSnapshot.parse({
      keys, prefs: { theme, voiceEngine, replySound, inAppToasts, systemNotifications },
    }));
    if (Buffer.byteLength(body) > 7000) throw new Error('Account backup exceeds the size limit.');
  }
  const response = await request(endpoint, {
    method: { save: 'PATCH', restore: 'GET', clear: 'DELETE' }[action],
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    ...(body ? { body } : {}), signal: AbortSignal.timeout(20000), redirect: 'error',
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error('No account backup was found.');
    if (response.status === 401) throw new Error('Sign in again to sync this device.');
    if ([413, 422].includes(response.status)) throw new Error('Check the account metadata format and size.');
    throw new Error('Account sync is unavailable. Try again later.');
  }
  if (action === 'restore') {
    const snapshot = accountSnapshot.parse(await response.json());
    keys = snapshot.keys;
    await vault.setMany(Object.entries(keys).map(([name, value]) => ({ name, value })));
    await updatePrefs(snapshot.prefs);
  }
  return Object.keys(keys).length;
}
