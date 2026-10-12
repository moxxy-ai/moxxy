import { defineProvider, definePlugin, MoxxyError } from '@moxxy/sdk';
import { CLAUDE_CODE_PROVIDER_ID, CLAUDE_CODE_SERVICE_NAME } from './constants.js';
import {
  claudeCodeModels,
  claudeSessions,
  createClaudeCodeClient,
  type ClaudeAgentProviderConfig,
} from './agent-provider.js';
import { claudeExecutableForSdk, resolveClaudeForSdk } from './executable.js';
import {
  claudeLogin,
  claudeLogout,
  claudeStatus,
  checkClaudeCliAuth,
  resolveClaudeExecutable,
} from './login.js';
import { ensureClaudeAgentSdk } from './sdk-install.js';

export const claudeCodeProviderDef = defineProvider({
  name: CLAUDE_CODE_PROVIDER_ID,
  agentName: 'Claude',
  models: claudeCodeModels,
  createClient: (config) => createClaudeCodeClient(providerConfigFrom(config)),
  async resolveCredentials({ providerConfig, host }) {
    const config = { ...providerConfig, cwd: host.cwd };
    const command = resolveClaudeExecutable(config);
    const status = await checkClaudeCliAuth(command);
    if (status.state !== 'signed-in') {
      throw new MoxxyError({
        code: status.state === 'signed-out' ? 'AUTH_NO_CREDENTIALS' : 'AUTH_INVALID',
        message: status.message,
        hint: status.state === 'signed-out' ? `Run \`moxxy login ${CLAUDE_CODE_PROVIDER_ID}\`.` : undefined,
        context: { provider: CLAUDE_CODE_PROVIDER_ID, executable: command, state: status.state },
      });
    }
    // The Agent SDK is fetched the first time the Claude connection is used, not with Moxxy.
    await ensureClaudeAgentSdk();
    const executable = command.includes('/') || command.includes('\\') ? claudeExecutableForSdk(command) : resolveClaudeForSdk(command);
    return { ...config, ...(executable ? { executable } : {}) };
  },
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
  hooks: {
    // The conversation's Claude ends with it; Claude's own session stays on disk to resume.
    onShutdown: (ctx) => claudeSessions().close(String(ctx.sessionId)),
  },
});

export default claudeCodePlugin;

function providerConfigFrom(config: Readonly<Record<string, unknown>>): ClaudeAgentProviderConfig {
  const text = (key: string) => (typeof config[key] === 'string' && config[key] !== '' ? (config[key] as string) : undefined);
  const executable = text('executable');
  const model = text('model');
  const defaultModel = text('defaultModel');
  const cwd = text('cwd');
  return {
    ...(executable ? { executable } : {}),
    ...(model ? { model } : {}),
    ...(defaultModel ? { defaultModel } : {}),
    ...(cwd ? { cwd } : {}),
  };
}

export {
  CLAUDE_CODE_PROVIDER_ID,
  CLAUDE_CODE_SERVICE_NAME,
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
  ClaudeAgentProvider,
  claudeCodeModels,
  claudeSessions,
  createClaudeCodeClient,
  type ClaudeAgentProviderConfig,
} from './agent-provider.js';
export { CLAUDE_AGENT_SDK_VERSION, claudeAgentSdkHome, ensureClaudeAgentSdk } from './sdk-install.js';
