import { describe, expect, it } from 'vitest';
import { hasPersonalFeature } from './account-features';

describe('personal feature grants', () => {
  it.each(['u:device_key_sync', 'uo:device_key_sync', 'ou:device_key_sync', 'o:x, u:device_key_sync'])(
    'recognizes the user scope in %s', fea => expect(hasPersonalFeature({ fea }, 'device_key_sync')).toBe(true),
  );
  it.each([undefined, null, [], '', 'device_key_sync', 'o:device_key_sync', 'u:device_key_sync_extra', 'u:other'])(
    'requires an explicit matching feature', fea => expect(hasPersonalFeature({ pla: 'u:pro', fea }, 'device_key_sync')).toBe(false),
  );
});
