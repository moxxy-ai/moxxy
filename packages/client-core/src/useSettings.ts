import { useCallback, useEffect, useState } from 'react';
import { api } from './transport.js';
import { getPlatform } from './platform.js';
import { toErrorMessage } from './errors.js';
import {
  SESSION_INFO_REFRESH_EVENT,
  type McpServerEntry,
  type ProviderEntry,
  type SkillFile,
  type VaultEntryName,
} from '@moxxy/desktop-ipc-contract';

export interface UseSettings {
  readonly providers: ReadonlyArray<ProviderEntry>;
  readonly mcp: ReadonlyArray<McpServerEntry>;
  readonly vault: ReadonlyArray<VaultEntryName>;
  readonly skills: ReadonlyArray<SkillFile>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
  readonly toggleMcp: (name: string, enabled: boolean) => Promise<void>;
  /** Enable/disable a provider on the runner. Surfaces the runner's error
   *  (e.g. refusing to disable the ACTIVE provider) via `error`. */
  readonly setProviderEnabled: (name: string, enabled: boolean) => Promise<void>;
  /** Patch a stored (admin) provider's config. Throws so the configure
   *  sheet can render the error inline. */
  readonly configureProvider: (
    name: string,
    patch: { baseURL?: string; defaultModel?: string; envVar?: string },
  ) => Promise<void>;
  /** Save an API key to the vault under `keyName`, then have the runner
   *  re-probe credentials so the readiness dot flips live. Throws for
   *  inline error rendering. */
  readonly setProviderKey: (keyName: string, value: string) => Promise<void>;
  /** Ask the runner to re-probe every provider's credentials, then refetch the
   *  list, so a readiness change (e.g. just completed an OAuth sign-in) shows up
   *  without a restart. Best-effort on the re-probe (a pre-v7 runner just needs
   *  a reboot to notice). */
  readonly reprobeProviders: () => Promise<void>;
  readonly readSkill: (name: string) => Promise<string>;
  readonly writeSkill: (name: string, body: string) => Promise<void>;
  readonly deleteSkill: (name: string) => Promise<void>;
  readonly setVaultKey: (name: string, value: string) => Promise<void>;
  readonly removeVaultKey: (name: string) => Promise<void>;
}

export function useSettings(): UseSettings {
  const [providers, setProviders] = useState<ReadonlyArray<ProviderEntry>>([]);
  const [mcp, setMcp] = useState<ReadonlyArray<McpServerEntry>>([]);
  const [vault, setVault] = useState<ReadonlyArray<VaultEntryName>>([]);
  const [skills, setSkills] = useState<ReadonlyArray<SkillFile>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [p, m, v, s] = await Promise.all([
        api().invoke('settings.providers').catch(() => []),
        api().invoke('settings.mcpServers').catch(() => []),
        api().invoke('settings.vaultEntries').catch(() => []),
        api().invoke('settings.skills').catch(() => []),
      ]);
      setProviders(p);
      setMcp(m);
      setVault(v);
      setSkills(s);
      setError(null);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-fetch whenever the session-info refresh signal fires — emitted by the
  // renderer's own pickers AND (via useSessionInfoBridge) by the runner's
  // `info.changed` push, so a provider/MCP/skill/workflow added by the agent
  // mid-conversation shows up here without reopening Settings.
  useEffect(() => {
    const off = getPlatform().eventBus?.on(SESSION_INFO_REFRESH_EVENT, () => {
      void refresh();
    });
    return off;
  }, [refresh]);

  const toggleMcp = useCallback(
    async (name: string, enabled: boolean): Promise<void> => {
      try {
        await api().invoke('settings.mcpToggle', { name, enabled });
        await refresh();
      } catch (e) {
        setError(toErrorMessage(e));
      }
    },
    [refresh],
  );

  const setProviderEnabled = useCallback(
    async (name: string, enabled: boolean): Promise<void> => {
      try {
        await api().invoke('settings.providerSetEnabled', { name, enabled });
        await refresh();
      } catch (e) {
        setError(toErrorMessage(e));
      }
    },
    [refresh],
  );

  const configureProvider = useCallback(
    async (
      name: string,
      patch: { baseURL?: string; defaultModel?: string; envVar?: string },
    ): Promise<void> => {
      // Let the configure sheet surface the error inline; still refresh on
      // success so the row reflects the new config.
      await api().invoke('settings.providerConfigure', { name, patch });
      await refresh();
    },
    [refresh],
  );

  const reprobeProviders = useCallback(async (): Promise<void> => {
    // Have the runner re-resolve every provider's credentials so a readiness
    // change flips without a restart. Best-effort — a pre-v7 runner lacks the
    // method and just needs a reboot to notice.
    try {
      await api().invoke('settings.providerRefreshReady');
    } catch {
      /* pre-v7 runner — readiness updates on next boot */
    }
    await refresh();
  }, [refresh]);

  const setProviderKey = useCallback(
    async (keyName: string, value: string): Promise<void> => {
      await api().invoke('settings.vaultSet', { name: keyName, value });
      // The key is on disk; re-probe so the readiness dot flips without a restart.
      await reprobeProviders();
    },
    [reprobeProviders],
  );

  const readSkill = useCallback(
    async (name: string): Promise<string> =>
      api().invoke('settings.readSkill', { name }),
    [],
  );
  const writeSkill = useCallback(
    async (name: string, body: string): Promise<void> => {
      try {
        await api().invoke('settings.writeSkill', { name, body });
        await refresh();
      } catch (e) {
        setError(toErrorMessage(e));
      }
    },
    [refresh],
  );

  const deleteSkill = useCallback(
    async (name: string): Promise<void> => {
      try {
        await api().invoke('settings.deleteSkill', { name });
        await refresh();
      } catch (e) {
        setError(toErrorMessage(e));
      }
    },
    [refresh],
  );

  const setVaultKey = useCallback(
    async (name: string, value: string): Promise<void> => {
      // Let the caller surface the error (the add form shows it inline),
      // but still refresh + re-throw so the list updates on success.
      await api().invoke('settings.vaultSet', { name, value });
      await refresh();
    },
    [refresh],
  );

  const removeVaultKey = useCallback(
    async (name: string): Promise<void> => {
      try {
        await api().invoke('settings.vaultDelete', { name });
        await refresh();
      } catch (e) {
        setError(toErrorMessage(e));
      }
    },
    [refresh],
  );

  return {
    providers,
    mcp,
    vault,
    skills,
    loading,
    error,
    refresh,
    toggleMcp,
    setProviderEnabled,
    configureProvider,
    setProviderKey,
    reprobeProviders,
    readSkill,
    writeSkill,
    deleteSkill,
    setVaultKey,
    removeVaultKey,
  };
}
