import { defineProvider, definePlugin } from '@moxxy/sdk';
import { anthropicModels } from '@moxxy/plugin-provider-anthropic';
import { CLAUDE_CODE_PROVIDER_ID, CLAUDE_CODE_SERVICE_NAME } from './constants.js';
import { createClaudeCodeClient, type ClaudeCodeProviderConfig } from './provider.js';
import { claudeLogin, claudeLogout, claudeStatus } from './login.js';

export const claudeCodeProviderDef = defineProvider({
  name: CLAUDE_CODE_PROVIDER_ID,
  // Same Claude models as the API-key `anthropic` provider — it's the same
  // Messages API, only the credential differs.
  models: [...anthropicModels],
  createClient: (config) => createClaudeCodeClient(config as ClaudeCodeProviderConfig),
  // No validateKey: an OAuth bearer is validated by the request itself, and
  // an interactive paste/sign-in already proves the token round-trips.
  auth: {
    kind: 'oauth',
    serviceName: CLAUDE_CODE_SERVICE_NAME,
    login: claudeLogin,
    logout: claudeLogout,
    status: claudeStatus,
  },
});

export const claudeCodePlugin = definePlugin({
  name: '@moxxy/plugin-provider-claude-code',
  version: '0.0.0',
  providers: [claudeCodeProviderDef],
});

export default claudeCodePlugin;

export {
  CLAUDE_CODE_PROVIDER_ID,
  CLAUDE_CODE_SERVICE_NAME,
  CLAUDE_CODE_SYSTEM,
  CLAUDE_OAUTH_BETA,
  CLAUDE_TOKEN_ENV_VARS,
} from './constants.js';
export {
  claudeLogin,
  claudeLogout,
  claudeStatus,
  ensureFreshClaudeTokens,
  refreshClaudeAccessToken,
  refreshClaudeTokenDirect,
  type FreshClaudeTokens,
} from './login.js';
export {
  readInstalledClaudeCreds,
  writeInstalledClaudeCreds,
  type InstalledClaudeCreds,
} from './cli-creds.js';
export { createClaudeCodeClient, type ClaudeCodeProviderConfig } from './provider.js';
