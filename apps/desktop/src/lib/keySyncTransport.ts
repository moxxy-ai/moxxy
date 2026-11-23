import type { IpcCommandName, MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { builtinProviderKeyName, isSyncKeyName } from '@moxxy/desktop-ipc-contract/account-sync';

type SessionToken = () => Promise<string | null>;

// Capture the active session when the person submits the form. Never look up a
// different account to finish a write that began under the previous account.
let getSession: () => SessionToken | null = () => null;

export function registerKeySyncSession(read: () => SessionToken | null): () => void {
  getSession = read;
  return () => { if (getSession === read) getSession = () => null; };
}

function editedKey(command: IpcCommandName, input: unknown) {
  if (!input || typeof input !== 'object') return;
  if (command === 'onboarding.saveProviderKey' && 'provider' in input && typeof input.provider === 'string' &&
      'secret' in input && typeof input.secret === 'string') {
    return { name: builtinProviderKeyName(input.provider), value: input.secret };
  }
  if (!('name' in input) || typeof input.name !== 'string') return;
  if (command === 'settings.vaultDelete') return { name: input.name, value: null };
  if (command === 'settings.vaultSet' && 'value' in input && typeof input.value === 'string') {
    return { name: input.name, value: input.value };
  }
}

export function withAccountKeySync(base: MoxxyApi): MoxxyApi {
  let pending = Promise.resolve();
  return {
    subscribe: base.subscribe,
    invoke(command, ...args) {
      const edit = editedKey(command, args[0]);
      if (!edit || !isSyncKeyName(edit.name)) return base.invoke(command, ...args);
      const name = edit.name;
      const tokenForEdit = getSession();
      const run = async () => {
        await base.invoke(command, ...args);
        if (!tokenForEdit) return;
        try {
          const token = await tokenForEdit();
          if (!token) throw new Error('Sign in again.');
          await base.invoke('account.syncKey', { name, value: edit.value, token });
        } catch {
          throw new Error('The change was saved on this device. Account sync could not be confirmed. Check Device sync and retry the change.');
        }
      };
      // A quick rotation or deletion must reach Clerk after the original save.
      const done = pending.then(run);
      pending = done.catch(() => {});
      // Each of the three local credential commands returns Promise<void>.
      return done as ReturnType<typeof base.invoke<typeof command>>;
    },
  };
}
