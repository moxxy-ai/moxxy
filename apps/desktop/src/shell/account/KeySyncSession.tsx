import { useLayoutEffect } from 'react';
import { useClerk } from '@clerk/clerk-react';
import { keySyncDisabledField } from '@moxxy/desktop-ipc-contract/account-sync';
import { registerKeySyncSession } from '../../lib/keySyncTransport';

export function KeySyncSession(): null {
  const clerk = useClerk();
  useLayoutEffect(() => registerKeySyncSession(() => {
    const session = clerk.session;
    const enabled = () => session?.status === 'active' && !session.currentTask &&
      clerk.session?.id === session.id && session.user != null &&
      session.user.publicMetadata[keySyncDisabledField] !== true;
    if (!session || !enabled()) return null;
    return async () => {
      if (!enabled()) return null;
      const token = await session.getToken({ skipCache: true });
      return enabled() ? token : null;
    };
  }), [clerk]);
  return null;
}
