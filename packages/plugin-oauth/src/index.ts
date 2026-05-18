import { definePlugin, type Plugin } from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';
import {
  buildOauthAuthorizeTool,
  buildOauthClearTool,
  buildOauthGetTokenTool,
  type OAuthToolDeps,
} from './tools.js';

export { buildAuthUrl, runAuthorizationCodeFlow, runDeviceCodeFlow, refreshAccessToken } from './flow.js';
export type { OAuthFlowOptions, DeviceFlowOptions, DevicePrompt, TokenSet } from './flow.js';
export { computeCodeChallenge, generateCodeVerifier, generateState } from './pkce.js';
export {
  clearStoredCreds,
  isExpired,
  readStoredCreds,
  storeTokenSet,
  validateProvider,
  type StoredCreds,
} from './storage.js';
export {
  buildOauthAuthorizeTool,
  buildOauthClearTool,
  buildOauthGetTokenTool,
  type OAuthToolDeps,
} from './tools.js';

export interface BuildOauthPluginOpts {
  readonly vault: VaultStore;
}

/**
 * `@moxxy/plugin-oauth` — generic OAuth 2.0 + PKCE client.
 *
 * Provides three tools (`oauth_authorize`, `oauth_get_token`,
 * `oauth_clear_token`) that any other tool/skill can use to obtain a
 * bearer token for an OAuth provider. Tokens persist in the vault
 * under `oauth/<provider>/*` so subsequent sessions inherit them.
 *
 * Supports both the loopback callback (default — opens browser, listens
 * on http://localhost:8765/callback) and the RFC 8628 device-code flow
 * (for headless hosts where the user has no local browser).
 *
 * Bundled skills explain when to use it and walk through the Google
 * Cloud Console setup needed for Google Workspace OAuth.
 */
export function buildOauthPlugin(opts: BuildOauthPluginOpts): Plugin {
  const deps: OAuthToolDeps = { vault: opts.vault };
  return definePlugin({
    name: '@moxxy/plugin-oauth',
    version: '0.0.0',
    tools: [
      buildOauthAuthorizeTool(deps),
      buildOauthGetTokenTool(deps),
      buildOauthClearTool(deps),
    ],
  });
}
