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
export async function resolveString(
  input: string,
  source: SecretLookup | VaultStore,
): Promise<string> {
  const lookup = asLookup(source);
  PLACEHOLDER_RE.lastIndex = 0;
  if (!PLACEHOLDER_RE.test(input)) return input;
  PLACEHOLDER_RE.lastIndex = 0;
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = PLACEHOLDER_RE.exec(input))) names.add(m[1]!);

  const values = new Map<string, string>();
  for (const name of names) {
    const value = await lookup(name);
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

/**
 * How a `${vault:NAME}` placeholder is looked up.
 *
 * A FUNCTION rather than a `VaultStore` so one code path serves both the local
 * vault and whatever external store a machine has active. Previously this took
 * the vault directly, which meant config placeholders could only ever come from
 * the local vault while `ctx.getSecret` in a tool went through the active
 * SecretProvider: two ways to say `${vault:KEY}` that resolved differently.
 */
export type SecretLookup = (name: string) => Promise<string | null>;

/** Walk an arbitrary value, resolving all vault placeholders in nested strings. */
export async function resolveValue(value: unknown, lookup: SecretLookup | VaultStore): Promise<unknown> {
  return resolveValueInner(value, asLookup(lookup), new Set());
}

/** Accepts a bare `VaultStore` so existing callers keep working unchanged. */
function asLookup(source: SecretLookup | VaultStore): SecretLookup {
  return typeof source === 'function' ? source : (name) => source.get(name);
}

// `ancestors` is the chain of objects on the path from the root to (but not
// including) the current node, so a node that appears as its own ancestor is a
// true cycle — while a shared object reachable via two *sibling* paths (a legal
// DAG) is resolved on each path rather than falsely flagged. The chain length
// is the nesting depth, so its size doubles as the depth bound.
async function resolveValueInner(
  value: unknown,
  lookup: SecretLookup,
  ancestors: Set<object>,
): Promise<unknown> {
  if (typeof value === 'string') return await resolveString(value, lookup);
  if (value && typeof value === 'object') {
    if (ancestors.has(value)) throw tooDeepError(); // reference cycle
    if (ancestors.size >= MAX_DEPTH) throw tooDeepError();
    const nextAncestors = new Set(ancestors).add(value);
    if (Array.isArray(value)) {
      return Promise.all(value.map((v) => resolveValueInner(v, lookup, nextAncestors)));
    }
    // Resolve object properties concurrently (mirrors the array branch); each
    // leaf may await vault.get(), so serializing them needlessly serializes I/O.
    const pairs = await Promise.all(
      Object.entries(value as Record<string, unknown>).map(
        async ([k, v]) => [k, await resolveValueInner(v, lookup, nextAncestors)] as const,
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
