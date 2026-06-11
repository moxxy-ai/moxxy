/**
 * The office channel's bearer token, resolved via the shared channel-auth
 * convention (env `MOXXY_OFFICE_TOKEN` → `channels.office.token` config → a
 * generated secret persisted at `~/.moxxy/office-token`). Thin wrapper over
 * the SDK helper so every channel resolves auth the same way.
 */

import { resolveChannelToken, rotateChannelToken } from '@moxxy/sdk';

const TOKEN_FILE = 'office-token';

export function resolveOfficeToken(configured?: string): string {
  return resolveChannelToken({
    configured,
    envVar: 'MOXXY_OFFICE_TOKEN',
    fileName: TOKEN_FILE,
  });
}

/** Rotate the persisted secret (`~/.moxxy/office-token`) and return the new
 *  token. Env/config-supplied tokens take precedence and must be rotated at
 *  their source — see `rotateChannelToken`. */
export function rotateOfficeToken(): string {
  return rotateChannelToken({ fileName: TOKEN_FILE });
}
