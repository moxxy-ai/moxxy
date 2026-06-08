/**
 * `OAuthProviderProfile` for the Claude subscription provider. Unlike the
 * codex profile this one does NOT drive `runOauthLogin` — Claude uses an
 * out-of-band (manual code-paste) flow that the framework's loopback/device
 * orchestrators don't model, so login lives in `login.ts`. The profile is
 * still used for the parts the framework DOES own: `ensureFreshTokens`
 * (refresh + persist) and the `storeTokenSet` metadata layout.
 */

import type { OAuthProviderProfile } from '@moxxy/plugin-oauth';
import {
  CLAUDE_AUTHORIZE_URL,
  CLAUDE_CLIENT_ID,
  CLAUDE_CODE_PROVIDER_ID,
  CLAUDE_CODE_SERVICE_NAME,
  CLAUDE_SCOPES,
  CLAUDE_TOKEN_URL,
} from './constants.js';

export const claudeOauthProfile: OAuthProviderProfile = {
  id: CLAUDE_CODE_PROVIDER_ID,
  displayName: CLAUDE_CODE_SERVICE_NAME,
  authUrl: CLAUDE_AUTHORIZE_URL,
  tokenUrl: CLAUDE_TOKEN_URL,
  clientId: CLAUDE_CLIENT_ID,
  scopes: [...CLAUDE_SCOPES],
};
