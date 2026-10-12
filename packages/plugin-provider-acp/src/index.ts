import { defineProvider, definePlugin } from '@moxxy/sdk';
import { OPENCODE_PROVIDER_ID, OPENCODE_SERVICE_NAME } from './constants.js';
import { OPENCODE_AGENT } from './agents.js';
import { acpModel, acpSessions, createAcpAgentClient, type AcpAgentProviderConfig } from './agent-provider.js';
import { authError, checkOpenCode, listOpenCodeModels, opencodeLogin, opencodeLogout, opencodeStatus, resolveOpenCodeExecutable } from './login.js';

export const opencodeProviderDef = defineProvider({
  name: OPENCODE_PROVIDER_ID,
  agentName: OPENCODE_AGENT.label,
  models: [acpModel(OPENCODE_AGENT.defaultModel)],
  createClient: (config) => createAcpAgentClient(providerConfigFrom(config)),
  async resolveCredentials({ providerConfig, host }) {
    const config = { ...providerConfig, cwd: host.cwd };
    const executable = resolveOpenCodeExecutable(config);
    const status = await checkOpenCode(executable);
    if (status.state !== 'signed-in') throw authError(status);
    // The picker offers exactly what the person's OpenCode can run.
    return { ...config, executable, models: await listOpenCodeModels(executable) };
  },
  // No validateKey: readiness is reported by the installed OpenCode.
  auth: {
    kind: 'oauth',
    serviceName: OPENCODE_SERVICE_NAME,
    login: opencodeLogin,
    logout: opencodeLogout,
    status: opencodeStatus,
  },
});

export const acpAgentPlugin = definePlugin({
  name: '@moxxy/plugin-provider-acp',
  version: '0.0.0',
  providers: [opencodeProviderDef],
  hooks: {
    // The conversation's agent ends with it; its session stays saved by the agent, to load.
    onShutdown: (ctx) => acpSessions().close(String(ctx.sessionId)),
  },
});

export default acpAgentPlugin;

function providerConfigFrom(config: Readonly<Record<string, unknown>>): AcpAgentProviderConfig {
  const text = (key: string) => (typeof config[key] === 'string' && config[key] !== '' ? (config[key] as string) : undefined);
  const executable = text('executable');
  const model = text('model');
  const defaultModel = text('defaultModel');
  const cwd = text('cwd');
  const models = Array.isArray(config.models) ? config.models.filter((id): id is string => typeof id === 'string' && id !== '') : [];
  return {
    ...(executable ? { executable } : {}),
    ...(model ? { model } : {}),
    ...(defaultModel ? { defaultModel } : {}),
    ...(cwd ? { cwd } : {}),
    ...(models.length > 0 ? { models } : {}),
  };
}

export { OPENCODE_PROVIDER_ID, OPENCODE_SERVICE_NAME, OPENCODE_EXECUTABLE_ENV, OPENCODE_DEFAULT_MODEL } from './constants.js';
export { OPENCODE_AGENT, type AcpAgentSpec } from './agents.js';
export { AcpAgentProvider, acpModel, acpSessions, createAcpAgentClient, type AcpAgentProviderConfig } from './agent-provider.js';
export type { AcpConnection, StartAcpAgent } from './acp-session.js';
export { opencodeTarget, spawnOpenCodeAcp } from './executable.js';
export {
  __setOpenCodeCommandRunner,
  checkOpenCode,
  listOpenCodeModels,
  opencodeLogin,
  opencodeLogout,
  opencodeStatus,
  resolveOpenCodeExecutable,
  type OpenCodeState,
  type OpenCodeStatus,
} from './login.js';
