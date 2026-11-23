import { describe, expect, it } from 'vitest';
import { sessionAllowsFeature } from './usePersonalFeature';

type Auth = Parameters<typeof sessionAllowsFeature>[0];
const claims = { sub: 'user_a', sid: 'sess_a', pla: 'u:free', fea: 'u:device_key_sync,u:local_assistant' };
const auth = { userId: claims.sub, sessionId: claims.sid, isSignedIn: true, sessionClaims: claims } as Auth;

describe('feature access in the desktop session', () => {
  it('follows feature changes even within the same plan', () => {
    expect(sessionAllowsFeature(auth, 'device_key_sync')).toBe(true);
    expect(sessionAllowsFeature({ ...auth, sessionClaims: { ...auth.sessionClaims!, fea: 'u:local_assistant' } }, 'device_key_sync')).toBe(false);
  });

  it('drops previous grants on sign-out, session switches and account switches', () => {
    for (const change of [{ isSignedIn: false }, { sessionId: 'sess_b' }, { userId: 'user_b' }, { sessionClaims: null }]) {
      expect(sessionAllowsFeature({ ...auth, ...change }, 'device_key_sync')).toBe(false);
    }
  });

  it('preserves only pre-Billing device sync for authenticated sessions without billing claims', () => {
    const legacy = { ...auth, sessionClaims: { ...auth.sessionClaims!, fea: undefined, pla: undefined } } as Auth;
    expect(sessionAllowsFeature(legacy, 'device_key_sync')).toBe(true);
    expect(sessionAllowsFeature(legacy, 'model_connections')).toBe(false);
  });
});
