import { useEffect, useRef } from 'react';
import { useUser } from '@clerk/react';
import { api } from '@moxxy/client-core';

export function AccountIdentityBridge(): null {
  const { isLoaded, user } = useUser();
  // Account switches may race an earlier async prefs write. Read after it settles.
  const pending = useRef(Promise.resolve());
  const id = user?.id ?? null;
  const name = user ? user.fullName ?? user.primaryEmailAddress?.emailAddress ?? user.username ?? 'Account' : null;
  useEffect(() => {
    if (!isLoaded) return;
    let active = true;
    pending.current = pending.current.then(async () => {
      if (!active) return;
      const prefs = await api().invoke('prefs.read');
      if (!active) return;
      if (prefs.clerkUserId === id && prefs.clerkDisplayName === name && (!!prefs.signedInAt === !!id)) return;
      await api().invoke('prefs.update', {
        clerkUserId: id, clerkDisplayName: name,
        signedInAt: id ? (prefs.clerkUserId === id ? prefs.signedInAt ?? Date.now() : Date.now()) : null,
      });
    }).catch(() => console.warn('Could not update the cached account identity.'));
    return () => { active = false; };
  }, [isLoaded, id, name]);
  return null;
}
