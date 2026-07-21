import { defineProvider, definePlugin, MoxxyError } from '@moxxy/sdk';
import { CodexProvider, type CodexProviderConfig } from './provider.js';
import { codexModels } from './models.js';
import {
  codexLogin,
  codexLogout,
  codexStatus,
  persistCodexTokens,
  readStoredTokens,
} from './login.js';
import type { CodexTokens } from './types.js';
import { PLUGIN_VERSION } from './codex/headers.js';

export const openaiCodexProviderDef = defineProvider({
  name: 'openai-codex',
  models: [...codexModels],
  createClient: (config) => new CodexProvider(config as CodexProviderConfig),
  async resolveCredentials({ vault, providerConfig }) {
    const tokens = await readStoredTokens(vault).catch(() => null);
    if (!tokens) {
      throw new MoxxyError({
        code: 'AUTH_NO_CREDENTIALS',
        message: 'No ChatGPT OAuth credentials found in the vault.',
        hint: 'Run `moxxy login openai-codex` to sign in with your ChatGPT Pro/Plus account.',
        context: { provider: 'openai-codex' },
      });
    }
    return {
      ...providerConfig,
      tokens,
      onTokensRefreshed: (next: CodexTokens) => persistCodexTokens(vault, next),
      reloadTokens: () => readStoredTokens(vault),
    };
  },
  // No validateKey: OAuth credentials are validated by the OAuth token
  // exchange itself, not by a synchronous key check.
  auth: {
    kind: 'oauth',
    serviceName: 'ChatGPT Pro/Plus',
    // The codex profile carries a device-flow adapter, so `codexLogin` honours
    // `ctx.headless` with a real no-browser flow — let hosts offer the choice.
    supportsHeadless: true,
    login: codexLogin,
    logout: codexLogout,
    status: codexStatus,
  },
});

export const openaiCodexPlugin = definePlugin({
  name: '@moxxy/plugin-provider-openai-codex',
  version: PLUGIN_VERSION,
  providers: [openaiCodexProviderDef],
});

export default openaiCodexPlugin;

export { CodexProvider } from './provider.js';
export { codexModels, DEFAULT_CODEX_MODEL } from './models.js';
export {
  CLIENT_ID,
  ISSUER,
  AUTHORIZE_URL,
  TOKEN_URL,
  CODEX_RESPONSES_URL,
  DEFAULT_CALLBACK_PORT,
  DEFAULT_REDIRECT_PATH,
  DEFAULT_REDIRECT_URI,
  SCOPES,
  ORIGINATOR,
  generatePKCE,
  generateState,
  buildAuthorizeUrl,
  parseJwtClaims,
  extractAccountId,
  exchangeCodeForTokens,
  refreshTokens,
} from './oauth.js';
export {
  CODEX_PROVIDER_ID,
  codexOauthProfile,
} from './profile.js';
export {
  codexLogin,
  codexLogout,
  codexStatus,
  ensureFreshCodexTokens,
  persistCodexTokens,
  readStoredTokens,
  readStoredTokens as readCodexStoredTokens,
} from './login.js';
export type { CodexProviderConfig } from './provider.js';
export type { CodexTokens, PkceCodes, OAuthTokenResponse } from './types.js';
