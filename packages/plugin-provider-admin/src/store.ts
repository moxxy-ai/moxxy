import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { StoredProvider, StoredProvidersConfig } from './types.js';

/**
 * User-level provider catalog. Mirrors the MCP admin storage pattern:
 * a JSON file in ~/.moxxy/ that the admin tools mutate and the plugin's
 * onInit hook reads back on every boot to repopulate the registry.
 */
export function providersConfigPath(): string {
  return path.join(os.homedir(), '.moxxy', 'providers.json');
}

export async function readProvidersConfig(filePath: string = providersConfigPath()): Promise<StoredProvidersConfig> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as StoredProvidersConfig).providers)) {
      return parsed as StoredProvidersConfig;
    }
  } catch {
    // missing or malformed — start fresh
  }
  return { providers: [] };
}

export async function writeProvidersConfig(
  cfg: StoredProvidersConfig,
  filePath: string = providersConfigPath(),
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, filePath);
}

export async function upsertStoredProvider(
  entry: StoredProvider,
  filePath: string = providersConfigPath(),
): Promise<StoredProvidersConfig> {
  const cfg = await readProvidersConfig(filePath);
  const next = cfg.providers.filter((p) => p.name !== entry.name);
  next.push(entry);
  const updated: StoredProvidersConfig = { providers: next };
  await writeProvidersConfig(updated, filePath);
  return updated;
}

export async function removeStoredProvider(
  name: string,
  filePath: string = providersConfigPath(),
): Promise<boolean> {
  const cfg = await readProvidersConfig(filePath);
  const next = cfg.providers.filter((p) => p.name !== name);
  if (next.length === cfg.providers.length) return false;
  await writeProvidersConfig({ providers: next }, filePath);
  return true;
}
