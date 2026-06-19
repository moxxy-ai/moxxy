import { promises as fs } from 'node:fs';
import { createMutex, z } from '@moxxy/sdk';
import { moxxyPath, writeFileAtomic } from '@moxxy/sdk/server';
import type { StoredProvider, StoredProvidersConfig } from './types.js';

/**
 * User-level provider catalog. Mirrors the MCP admin storage pattern:
 * a JSON file in ~/.moxxy/ that the admin tools mutate and the plugin's
 * onInit hook reads back on every boot to repopulate the registry.
 */
export function providersConfigPath(): string {
  return moxxyPath('providers.json');
}

/**
 * Schema for the on-disk providers.json. Kept loose on the model
 * descriptor (passthrough) so a richer descriptor written by a newer
 * build round-trips through an older one without losing fields, but
 * strict enough to discard a structurally-bogus file.
 */
const storedModelSchema = z
  .object({
    id: z.string().min(1),
    contextWindow: z.number(),
    // ModelDescriptor declares these as REQUIRED booleans; default them here so
    // a hand-edited / legacy providers.json round-trips into a complete
    // descriptor instead of reaching buildProviderDef with `undefined` (which
    // channels treat differently from `false` for tool/streaming gating).
    supportsTools: z.boolean().default(true),
    supportsStreaming: z.boolean().default(true),
  })
  .passthrough();

const storedProviderSchema = z
  .object({
    kind: z.literal('openai-compat'),
    name: z.string().min(1),
    baseURL: z.string().min(1),
    defaultModel: z.string().min(1),
    models: z.array(storedModelSchema),
    envVar: z.string().optional(),
    createdAt: z.string().optional(),
  })
  .passthrough();

const storedProvidersConfigSchema = z.object({
  providers: z.array(storedProviderSchema),
});

export async function readProvidersConfig(filePath: string = providersConfigPath()): Promise<StoredProvidersConfig> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    // A MISSING file means "no providers yet" — start fresh. But a genuine IO /
    // permission error (EACCES, EBUSY, EMFILE, …) must NOT be collapsed into an
    // empty catalog: doing so makes the plugin behave as if zero providers are
    // registered and the next read-modify-write would CLOBBER the real file.
    // Rethrow so callers (onInit's try/catch, the admin tools) see the failure.
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return { providers: [] };
    throw err;
  }
  // Malformed JSON / structurally-bogus content is intentionally treated as an
  // empty catalog (start fresh) rather than a hard failure.
  const parsed = storedProvidersConfigSchema.safeParse(parseJsonSafe(raw));
  if (parsed.success) {
    // The schema is intentionally looser than StoredProvidersConfig (model
    // descriptors are validated as id+contextWindow + passthrough, not the
    // full ModelDescriptor) so newer/older builds round-trip without losing
    // fields. Assert the domain type after the structural check.
    return parsed.data as unknown as StoredProvidersConfig;
  }
  return { providers: [] };
}

function parseJsonSafe(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export async function writeProvidersConfig(
  cfg: StoredProvidersConfig,
  filePath: string = providersConfigPath(),
): Promise<void> {
  await writeFileAtomic(filePath, JSON.stringify(cfg, null, 2) + '\n');
}

/**
 * Serializes the read-modify-write mutators below. Without this, two
 * concurrent upsert/remove calls could both read the same baseline and
 * the second write would clobber the first.
 */
const writeMutex = createMutex();

export async function upsertStoredProvider(
  entry: StoredProvider,
  filePath: string = providersConfigPath(),
): Promise<StoredProvidersConfig> {
  return writeMutex.run(async () => {
    const cfg = await readProvidersConfig(filePath);
    const next = cfg.providers.filter((p) => p.name !== entry.name);
    next.push(entry);
    const updated: StoredProvidersConfig = { providers: next };
    await writeProvidersConfig(updated, filePath);
    return updated;
  });
}

export async function removeStoredProvider(
  name: string,
  filePath: string = providersConfigPath(),
): Promise<boolean> {
  return writeMutex.run(async () => {
    const cfg = await readProvidersConfig(filePath);
    const next = cfg.providers.filter((p) => p.name !== name);
    if (next.length === cfg.providers.length) return false;
    await writeProvidersConfig({ providers: next }, filePath);
    return true;
  });
}
