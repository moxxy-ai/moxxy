import { defineProvider, definePlugin } from '@moxxy/sdk';
import { CLAUDE_CODE_PROVIDER_ID, CLAUDE_CODE_SERVICE_NAME } from './constants.js';
import {
  CLAUDE_CODE_DEFAULT_MODEL,
  claudeCodeModels,
  createClaudeCodeClient,
  type ClaudeCodeProviderConfig,
} from './provider.js';
import { claudeLogin, claudeLogout, claudeStatus } from './login.js';

export const claudeCodeProviderDef = defineProvider({
  name: CLAUDE_CODE_PROVIDER_ID,
  models: claudeCodeModels,
  createClient: (config) => createClaudeCodeClient({
    ...(config as ClaudeCodeProviderConfig),
    defaultModel:
      typeof (config as { model?: unknown }).model === 'string'
        ? (config as { model: string }).model
        : (config as ClaudeCodeProviderConfig).defaultModel ?? CLAUDE_CODE_DEFAULT_MODEL,
  }),
  // No validateKey: readiness is reported by the installed Claude CLI.
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
  CLAUDE_CODE_EXECUTABLE_ENV,
} from './constants.js';
export {
  claudeLogin,
  claudeLogout,
  claudeStatus,
  checkClaudeCliAuth,
  resolveClaudeExecutable,
  type ClaudeCliAuthStatus,
  type ClaudeCliAuthState,
  type ClaudeCommandResult,
  __setClaudeCommandRunner,
} from './login.js';
export {
  CLAUDE_CODE_DEFAULT_MODEL,
  claudeCodeModels,
  createClaudeCodeClient,
  type ClaudeCodeProviderConfig,
} from './provider.js';
