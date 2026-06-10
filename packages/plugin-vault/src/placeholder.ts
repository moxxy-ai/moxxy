import { MoxxyError } from '@moxxy/sdk';
import type { VaultStore } from './store.js';

const PLACEHOLDER_RE = /\$\{vault:([A-Za-z0-9_.-]+)\}/g;

/**
 * Resolve every `${vault:NAME}` placeholder in a string against the vault. If
 * any referenced key is missing, throws — secret refs are not optional.
 */
export async function resolveString(input: string, vault: VaultStore): Promise<string> {
  PLACEHOLDER_RE.lastIndex = 0;
  if (!PLACEHOLDER_RE.test(input)) return input;
  PLACEHOLDER_RE.lastIndex = 0;
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = PLACEHOLDER_RE.exec(input))) names.add(m[1]!);

  const values = new Map<string, string>();
  for (const name of names) {
    const value = await vault.get(name);
    if (value === null) {
      throw new MoxxyError({
        code: 'CONFIG_INVALID',
        message: `vault: missing required entry '${name}' referenced in config`,
        hint: `Add it with \`/vault set ${name} <value>\` (or the \`vault_set\` tool), then retry.`,
        context: { name },
      });
    }
    values.set(name, value);
  }
  return input.replace(PLACEHOLDER_RE, (_match, name: string) => values.get(name) ?? '');
}

/** Walk an arbitrary value, resolving all vault placeholders in nested strings. */
export async function resolveValue(value: unknown, vault: VaultStore): Promise<unknown> {
  if (typeof value === 'string') return await resolveString(value, vault);
  if (Array.isArray(value)) {
    return Promise.all(value.map((v) => resolveValue(v, vault)));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = await resolveValue(v, vault);
    }
    return out;
  }
  return value;
}

export function containsPlaceholder(value: unknown): boolean {
  if (typeof value === 'string') {
    PLACEHOLDER_RE.lastIndex = 0;
    return PLACEHOLDER_RE.test(value);
  }
  if (Array.isArray(value)) return value.some(containsPlaceholder);
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(containsPlaceholder);
  }
  return false;
}
