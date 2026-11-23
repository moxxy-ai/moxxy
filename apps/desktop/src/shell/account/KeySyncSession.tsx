import { useLayoutEffect } from 'react';
import { useAuth, useClerk } from '@clerk/react';
import { keySyncDisabledField } from '@moxxy/desktop-ipc-contract/account-sync';
import { registerKeySyncSession } from '../../lib/keySyncTransport';
import { sessionAllowsFeature } from './usePersonalFeature';

export function KeySyncSession(): null {
  const clerk = useClerk();
  const auth = useAuth();
  const { sessionId } = auth;
  const canSync = sessionAllowsFeature(auth, 'device_key_sync');
  useLayoutEffect(() => registerKeySyncSession(() => {
    const session = clerk.session;
    const enabled = () => canSync && session?.id === sessionId && session?.status === 'active' && !session.currentTask &&
      clerk.session?.id === session.id && session.user != null &&
      session.user.publicMetadata[keySyncDisabledField] !== true;
    if (!session || !enabled()) return null;
    return async () => {
      if (!enabled()) return null;
      const token = await session.getToken({ skipCache: true });
      return enabled() ? token : null;
    };
  }), [clerk, sessionId, canSync]);
  return null;
}
