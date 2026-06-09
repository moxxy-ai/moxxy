/**
 * The mobile channel's bearer token, resolved via the shared channel-auth
 * convention (env `MOXXY_MOBILE_TOKEN` → `channels.mobile.token` config → a
 * generated secret persisted at `~/.moxxy/mobile-token`). Thin wrapper over the
 * SDK helper so every channel resolves auth the same way.
 */

import { resolveChannelToken } from '@moxxy/sdk';

export function resolveMobileToken(configured?: string): string {
  return resolveChannelToken({
    configured,
    envVar: 'MOXXY_MOBILE_TOKEN',
    fileName: 'mobile-token',
  });
}
