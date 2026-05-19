import { loadConfig, type MoxxyConfig } from '@moxxy/config';
import { containsPlaceholder, resolveValue, type VaultStore } from '@moxxy/plugin-vault';

type InfoLogger = { info(msg: string, meta?: Record<string, unknown>): void };

export type ConfigSource = { scope: 'project' | 'user' | 'explicit'; path: string };

export interface LoadedConfig {
  readonly rawConfig: MoxxyConfig;
  readonly sources: ReadonlyArray<ConfigSource>;
}

export async function loadRawConfig(opts: {
  cwd: string;
  configPath?: string | undefined;
  skipUser?: boolean | undefined;
}): Promise<LoadedConfig> {
  const { config, sources } = await loadConfig({
    cwd: opts.cwd,
    explicitPath: opts.configPath,
    skipUser: opts.skipUser,
  });
  return { rawConfig: config, sources };
}

/** Resolve any `${vault:…}` placeholders against the user's open vault. */
export async function resolveConfigPlaceholders(
  rawConfig: MoxxyConfig,
  vault: VaultStore,
  logger: InfoLogger,
): Promise<MoxxyConfig> {
  if (!containsPlaceholder(rawConfig)) return rawConfig;
  logger.info('resolving vault placeholders in config');
  return (await resolveValue(rawConfig, vault)) as MoxxyConfig;
}
