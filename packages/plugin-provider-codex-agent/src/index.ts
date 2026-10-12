import { defineProvider, definePlugin, MoxxyError } from '@moxxy/sdk';
import { CODEX_AGENT_NAME, CODEX_AGENT_PROVIDER_ID, CODEX_SERVICE_NAME } from './constants.js';
import { codexAgentModels, codexSessions, createCodexAgentClient, type CodexAgentProviderConfig } from './agent-provider.js';
import { codexTarget } from './executable.js';
import { authError, checkCodexAuth, codexLogin, codexLogout, codexStatus, resolveCodexExecutable } from './login.js';

export const codexAgentProviderDef = defineProvider({
  name: CODEX_AGENT_PROVIDER_ID,
  agentName: CODEX_AGENT_NAME,
  models: codexAgentModels,
  createClient: (config) => createCodexAgentClient(providerConfigFrom(config)),
  async resolveCredentials({ providerConfig, host }) {
    const config = { ...providerConfig, cwd: host.cwd };
    const executable = resolveCodexExecutable(config);
    const status = await checkCodexAuth(executable);
    if (status.state !== 'signed-in') throw authError(status);
    try {
      codexTarget(executable);
    } catch (err) {
      throw new MoxxyError({
        code: 'AUTH_INVALID',
        message: err instanceof Error ? err.message : String(err),
        context: { provider: CODEX_AGENT_PROVIDER_ID, executable },
      });
    }
    return { ...config, executable };
  },
  // No validateKey: readiness is reported by the installed Codex CLI.
  auth: {
    kind: 'oauth',
    serviceName: CODEX_SERVICE_NAME,
    login: codexLogin,
    logout: codexLogout,
    status: codexStatus,
  },
});

export const codexAgentPlugin = definePlugin({
  name: '@moxxy/plugin-provider-codex-agent',
  version: '0.0.0',
  providers: [codexAgentProviderDef],
  hooks: {
    // The conversation's Codex ends with it; its thread stays saved by Codex, to resume.
    onShutdown: (ctx) => codexSessions().close(String(ctx.sessionId)),
  },
});

export default codexAgentPlugin;

function providerConfigFrom(config: Readonly<Record<string, unknown>>): CodexAgentProviderConfig {
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

export { CODEX_AGENT_PROVIDER_ID, CODEX_SERVICE_NAME, CODEX_EXECUTABLE_ENV } from './constants.js';
export {
  CODEX_AGENT_DEFAULT_MODEL,
  CodexAgentProvider,
  codexAgentModels,
  codexSessions,
  createCodexAgentClient,
  type CodexAgentProviderConfig,
} from './agent-provider.js';
export type { CodexConnection, StartCodexAppServer } from './codex-session.js';
export { codexTarget, spawnCodexAppServer } from './executable.js';
export {
  __setCodexCommandRunner,
  checkCodexAuth,
  codexLogin,
  codexLogout,
  codexStatus,
  resolveCodexExecutable,
  type CodexAuthState,
  type CodexAuthStatus,
} from './login.js';
