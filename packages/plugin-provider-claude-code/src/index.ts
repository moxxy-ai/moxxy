import { homedir } from 'node:os';
import { defineProvider, definePlugin, MoxxyError } from '@moxxy/sdk';
import { CLAUDE_CLI, checkAgentCli } from '@moxxy/agent-connection-kit';
import { CLAUDE_AGENT_NAME, CLAUDE_CODE_PROVIDER_ID, CLAUDE_CODE_SERVICE_NAME } from './constants.js';
import {
  CLAUDE_CODE_STARTER_MODEL,
  claudeCodeModels,
  claudeSessions,
  createClaudeCodeClient,
  type ClaudeAgentProviderConfig,
} from './agent-provider.js';
import { claudeForSdk } from './executable.js';
import {
  claudeLogin,
  claudeLogout,
  claudeSignIn,
  claudeStatus,
  checkClaudeCliAuth,
  resolveClaudeExecutable,
} from './login.js';
import { claudeOwnAutoApprove } from './own-settings.js';
import { claudeOfferedModels } from './offered-models.js';
import { ensureClaudeAgentSdk, installedClaudeAgentSdk } from './sdk-install.js';

export const claudeCodeProviderDef = defineProvider({
  name: CLAUDE_CODE_PROVIDER_ID,
  agentName: CLAUDE_AGENT_NAME,
  models: claudeCodeModels,
  starterModel: CLAUDE_CODE_STARTER_MODEL,
  agentCli: {
    check: (opts) => {
      const command = resolveClaudeExecutable();
      return checkAgentCli(CLAUDE_CLI, { command, refresh: opts?.refresh === true }, { signIn: () => claudeSignIn(command) });
    },
    // The SDK is installed when the connection is first used, never just to list models; until then the built-in list stands.
    models: async () => {
      const sdk = await installedClaudeAgentSdk();
      if (!sdk) return [];
      const executable = claudeForSdk(resolveClaudeExecutable());
      return claudeOfferedModels({ sdk, cwd: homedir(), ...(executable ? { executable } : {}) });
    },
  },
  ownAutoApprove: ({ cwd }) => claudeOwnAutoApprove(cwd),
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
    const executable = claudeForSdk(command);
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
  claudeSignIn,
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
  CLAUDE_CODE_STARTER_MODEL,
  ClaudeAgentProvider,
  claudeCodeModels,
  claudeSessions,
  createClaudeCodeClient,
  type ClaudeAgentProviderConfig,
} from './agent-provider.js';
export { CLAUDE_AGENT_SDK_VERSION, claudeAgentSdkHome, ensureClaudeAgentSdk } from './sdk-install.js';
