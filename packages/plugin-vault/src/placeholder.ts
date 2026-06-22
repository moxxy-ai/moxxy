import { MoxxyError } from '@moxxy/sdk';
import type { VaultStore } from './store.js';

const PLACEHOLDER_RE = /\$\{vault:([A-Za-z0-9_.-]+)\}/g;

// Bound recursion over caller-supplied objects: a pathologically deep config
// (or an in-memory reference cycle, which is legal for JS objects even though
// JSON can't express one) would otherwise overflow the stack and take down the
// process. 64 levels is far deeper than any real config tree.
const MAX_DEPTH = 64;

function tooDeepError(): MoxxyError {
  return new MoxxyError({
    code: 'CONFIG_INVALID',
    message: `vault: value nested too deeply (> ${MAX_DEPTH} levels) — possible reference cycle`,
    hint: 'Flatten the config or remove the cyclic reference before resolving vault placeholders.',
  });
}

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
  return resolveValueInner(value, vault, new Set());
}

// `ancestors` is the chain of objects on the path from the root to (but not
// including) the current node, so a node that appears as its own ancestor is a
// true cycle — while a shared object reachable via two *sibling* paths (a legal
// DAG) is resolved on each path rather than falsely flagged. The chain length
// is the nesting depth, so its size doubles as the depth bound.
async function resolveValueInner(
  value: unknown,
  vault: VaultStore,
  ancestors: Set<object>,
): Promise<unknown> {
  if (typeof value === 'string') return await resolveString(value, vault);
  if (value && typeof value === 'object') {
    if (ancestors.has(value)) throw tooDeepError(); // reference cycle
    if (ancestors.size >= MAX_DEPTH) throw tooDeepError();
    const nextAncestors = new Set(ancestors).add(value);
    if (Array.isArray(value)) {
      return Promise.all(value.map((v) => resolveValueInner(v, vault, nextAncestors)));
    }
    // Resolve object properties concurrently (mirrors the array branch); each
    // leaf may await vault.get(), so serializing them needlessly serializes I/O.
    const pairs = await Promise.all(
      Object.entries(value as Record<string, unknown>).map(
        async ([k, v]) => [k, await resolveValueInner(v, vault, nextAncestors)] as const,
      ),
    );
    return Object.fromEntries(pairs);
  }
  return value;
}

export function containsPlaceholder(value: unknown): boolean {
  return containsPlaceholderInner(value, new Set());
}

function containsPlaceholderInner(value: unknown, ancestors: Set<object>): boolean {
  if (typeof value === 'string') {
    PLACEHOLDER_RE.lastIndex = 0;
    return PLACEHOLDER_RE.test(value);
  }
  if (value && typeof value === 'object') {
    if (ancestors.has(value)) return false; // cycle — this subtree already inspected on the path
    if (ancestors.size >= MAX_DEPTH) throw tooDeepError();
    const nextAncestors = new Set(ancestors).add(value);
    if (Array.isArray(value)) {
      return value.some((v) => containsPlaceholderInner(v, nextAncestors));
    }
    return Object.values(value as Record<string, unknown>).some((v) =>
      containsPlaceholderInner(v, nextAncestors),
    );
  }
  return false;
}
