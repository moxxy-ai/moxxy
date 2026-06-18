/**
 * The mobile channel's bearer token, resolved via the shared channel-auth
 * convention (env `MOXXY_MOBILE_TOKEN` → `channels.mobile.token` config → a
 * generated secret persisted at `~/.moxxy/mobile-token`). Thin wrapper over the
 * SDK helper so every channel resolves auth the same way.
 */

import { resolveChannelToken, rotateChannelToken } from '@moxxy/sdk/server';

const TOKEN_FILE = 'mobile-token';

export function resolveMobileToken(configured?: string): string {
  return resolveChannelToken({
    configured,
    envVar: 'MOXXY_MOBILE_TOKEN',
    fileName: TOKEN_FILE,
  });
}

/** Rotate the persisted pairing secret (`~/.moxxy/mobile-token`) and return the
 *  new token. Env/config-supplied tokens take precedence and must be rotated at
 *  their source — see `rotateChannelToken`. */
export function rotateMobileToken(): string {
  return rotateChannelToken({ fileName: TOKEN_FILE });
}
