/**
 * Settings — providers, MCP servers, and skills.
 *
 * Provider listing comes in three flavours: the runner's *ready* set
 * (`settings.providers`), the onboarding *catalog* (built-ins +
 * admin-registered from providers.json), and live model discovery for
 * admin providers. MCP toggles and skill CRUD round out the settings
 * surface. Vault + desktop-prefs settings live in their own modules
 * (`./vault`, `./prefs`).
 */

import type { RunnerPool } from '../runner-pool';
import { handle, mustRemote, mustSession, resolveSupervisor } from './shared';

export function registerSettingsHandlers(pool: RunnerPool): void {
  // ---- Settings -----------------------------------------------------------

  handle('settings.fetchProviderModels', async ({ provider }) => {
    const { fetchProviderModels } = await import('../provider-discovery');
    return await fetchProviderModels(provider);
  });
  handle('settings.adminProviders', async () => {
    const { readAdminProviderNames } = await import('../provider-discovery');
    return readAdminProviderNames();
  });
  handle('settings.providerCatalog', async () => {
    // Built-ins are always pickable. Admin-registered ones come from
    // providers.json so the onboarding dropdown reflects whatever the
    // user already added via `provider_add` (zai, openrouter, …).
    const builtins = ['anthropic', 'openai', 'openai-codex'];
    const { readAdminProviderNames } = await import('../provider-discovery');
    const admin = await readAdminProviderNames();
    const seen = new Set<string>();
    return [...builtins, ...admin].filter((name) => {
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    });
  });
  handle('settings.providers', async (args) => {
    const sup = resolveSupervisor(pool, args?.workspaceId);
    const session = sup?.remote();
    if (!session) return [];
    const info = session.getInfo();
    const readySet = new Set(info.readyProviders ?? []);
    // Stored (runtime-registered) entries carry the configure-relevant
    // detail; providers absent from providers.json are built-ins.
    const { readAdminProviderDetails, builtinProviderKeyName } = await import('../provider-discovery');
    const admin = await readAdminProviderDetails();
    return info.providers.map((p) => {
      const detail = admin.get(p.name);
      return {
        name: p.name,
        ready: readySet.has(p.name),
        // Older runners (pre-v7) omit `enabled` — treat absent as enabled.
        enabled: p.enabled !== false,
        active: info.activeProvider === p.name,
        authKind: p.authKind,
        kind: detail ? ('admin' as const) : ('builtin' as const),
        keyName: detail?.keyName ?? builtinProviderKeyName(p.name),
        ...(detail
          ? {
              baseURL: detail.baseURL,
              defaultModel: detail.defaultModel,
              modelIds: detail.modelIds,
            }
          : {}),
      };
    });
  });
  handle('settings.providerSetEnabled', async ({ workspaceId, name, enabled }) => {
    await mustRemote(pool, workspaceId).providerAdmin.setEnabled(name, enabled);
  });
  handle('settings.providerConfigure', async ({ workspaceId, name, patch }) => {
    await mustRemote(pool, workspaceId).providerAdmin.configure(name, patch);
  });
  handle('settings.providerRefreshReady', async (args) => {
    await mustRemote(pool, args?.workspaceId).providerAdmin.refreshReady();
  });
  handle('settings.mcpServers', async (args) => {
    const session = mustSession(pool, args?.workspaceId);
    if (!session.mcpAdmin) return [];
    return await session.mcpAdmin.listServers();
  });
  handle('settings.mcpToggle', async ({ workspaceId, name, enabled }) => {
    const session = mustSession(pool, workspaceId);
    if (!session.mcpAdmin) throw new Error('mcp admin not available');
    if (enabled) await session.mcpAdmin.enableAndAttach(name);
    else await session.mcpAdmin.detach(name);
  });
  handle('settings.skills', async () => {
    const { listSkills } = await import('../skills');
    return listSkills();
  });
  handle('settings.readSkill', async ({ name }) => {
    const { readSkill } = await import('../skills');
    return readSkill(name);
  });
  handle('settings.writeSkill', async ({ name, body }) => {
    const { writeSkill } = await import('../skills');
    await writeSkill(name, body);
  });
  handle('settings.deleteSkill', async ({ name }) => {
    const { deleteSkill } = await import('../skills');
    await deleteSkill(name);
  });
}
