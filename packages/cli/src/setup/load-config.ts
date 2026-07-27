import {
  loadConfig,
  type ConfigLoadScope,
  type ConfigTrustPrompt,
  type LockedOverride,
  type MoxxyConfig,
} from '@moxxy/config';
import { containsPlaceholder, resolveValue, type VaultStore } from '@moxxy/plugin-vault';

type InfoLogger = { info(msg: string, meta?: Record<string, unknown>): void };

export type ConfigSource = { scope: ConfigLoadScope; path: string };

export interface LoadedConfig {
  readonly rawConfig: MoxxyConfig;
  readonly sources: ReadonlyArray<ConfigSource>;
  /** Locked dot-paths a lower layer tried to set and had stripped. */
  readonly lockedOverrides: ReadonlyArray<LockedOverride>;
  /** Executable configs found but not executed, with the reason. */
  readonly skippedConfigs: ReadonlyArray<{ readonly path: string; readonly reason: string }>;
}

export async function loadRawConfig(opts: {
  cwd: string;
  configPath?: string | undefined;
  skipUser?: boolean | undefined;
  /** Consent hook for an untrusted executable config; interactive surfaces only. */
  trustPrompt?: ConfigTrustPrompt | undefined;
}): Promise<LoadedConfig> {
  const { config, sources, lockedOverrides, skipped } = await loadConfig({
    cwd: opts.cwd,
    explicitPath: opts.configPath,
    skipUser: opts.skipUser,
    ...(opts.trustPrompt ? { trustPrompt: opts.trustPrompt } : {}),
  });
  return { rawConfig: config, sources, lockedOverrides, skippedConfigs: skipped };
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
