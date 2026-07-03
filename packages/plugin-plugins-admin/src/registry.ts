/**
 * Signed plugin-registry v1 — CLIENT side: verification, fetch, cache, and
 * fallback. The publisher tooling (index generation + signing) lives in the
 * PRIVATE infra repo and is deliberately absent from this monorepo.
 *
 * ## Index format (the contract the publisher must produce)
 *
 * Two sibling files, served over HTTPS (default: the `moxxy-ai/registry`
 * GitHub repo, raw `main`):
 *
 *   `index.json` — UTF-8 JSON:
 *     {
 *       "version": 1,                 // format version; anything else is refused
 *       "generatedAt": "<ISO 8601>",  // informational (NOT a freshness proof)
 *       "entries": [
 *         {
 *           "id": "telegram",                        // catalog id (stable, human)
 *           "label": "Telegram channel",
 *           "description": "…",
 *           "packageName": "@moxxy/plugin-telegram", // bare npm name
 *           "installSpec": "@moxxy/plugin-telegram", // npm name / git / path spec
 *           "version": "0.26.0",                     // EXACT semver — the pin
 *           "provides":     [{ "category": "channel", "name": "telegram" }], // optional
 *           "capabilities": { …CapabilitySpec… }                             // optional
 *         }
 *       ]
 *     }
 *
 *   `index.json.sig` — base64 Ed25519 signature over the EXACT BYTES of
 *   `index.json`, verified against the baked {@link REGISTRY_PUBLIC_KEY}.
 *
 * Unlike the desktop app-update manifest (whose signature is embedded inside
 * the signed document and therefore needs a canonical field-subset
 * serialization), the registry signature is DETACHED — it covers the raw file
 * verbatim, so there is no canonicalization step to keep in lockstep between
 * signer and verifier. The publisher signs the file it uploads; we verify the
 * bytes we downloaded.
 *
 * `version` is the integrity anchor: what the maintainer signed is a specific
 * pinned release of each package, so a catalog install that resolves through
 * a signed entry installs `packageName@version` — npm's `latest` dist-tag
 * (mutable, hijackable) stops being load-bearing. `capabilities` is the
 * package's DECLARED capability manifest (the `CapabilitySpec` shape from
 * `@moxxy/sdk`) so surfaces can show the blast radius before installing and
 * compare it against the post-install report (see
 * {@link checkCapabilityManifest} — warn-only in v1; enforcement arrives with
 * the consent phase).
 *
 * ## Trust model
 *
 * Single maintainer Ed25519 key, baked as {@link REGISTRY_PUBLIC_KEY}. Empty
 * key ⇒ the whole remote path is disabled (hardcoded catalog only). Key
 * rotation = ship a new CLI (see registry-key.ts). The fetch URL is
 * overridable via `MOXXY_REGISTRY_URL` (testing / self-hosting) — this is NOT
 * a trust decision: whatever the URL serves must still verify against the
 * baked key.
 *
 * ## Fallback semantics
 *
 * `fetchSignedRegistry` NEVER throws into the install path. Any failure —
 * missing key, network error, timeout, non-2xx, bad signature, invalid
 * schema, oversized body — degrades to the hardcoded
 * `INSTALLABLE_PLUGIN_CATALOG` with `source: 'fallback'` and a structured
 * `reason`. A verified index is cached at `~/.moxxy/registry-cache.json`
 * (bytes + signature) and RE-VERIFIED on every read — the cache is an
 * availability/latency optimization, never a trust anchor: a tampered cache
 * is discarded, and a cache older than the TTL (or timestamped in the
 * future) is ignored rather than reused, bounding how long a frozen/stale
 * index can be replayed.
 */

import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { z, type CapabilitySpec } from '@moxxy/sdk';
import { moxxyPath, writeFileAtomic } from '@moxxy/sdk/server';
import { INSTALLABLE_PLUGIN_CATALOG, resolveCatalogEntry, type PluginCatalogEntry } from './catalog.js';
import { NPM_NAME_RE } from './shared.js';
import { REGISTRY_PUBLIC_KEY } from './registry-key.js';

/** Signed index format version this client understands. */
export const REGISTRY_INDEX_VERSION = 1;

/** Default index location; `.sig` is fetched from `<url>.sig`. */
export const DEFAULT_REGISTRY_URL = 'https://raw.githubusercontent.com/moxxy-ai/registry/main/index.json';

/** Verified indexes are reused from cache for this long before re-fetching. */
export const REGISTRY_CACHE_TTL_MS = 60 * 60 * 1000;

/** Fail fast if the registry host stalls (mirrors the npm-search timeout). */
const REGISTRY_FETCH_TIMEOUT_MS = 10_000;

/** Cache file under `~/.moxxy` (bytes + sig; re-verified on read). */
const REGISTRY_CACHE_FILENAME = 'registry-cache.json';

/** Refuse absurd bodies before verifying/parsing them. A real index is a few
 *  hundred KB at most; this bounds what an unauthenticated response (the
 *  bytes arrive BEFORE signature verification) can make us JSON-parse. */
const MAX_INDEX_BYTES = 5 * 1024 * 1024;

/** Exact `x.y.z` (optionally prerelease-suffixed) — a pin, never a range. */
const EXACT_SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const providesSchema = z.array(
  z.object({ category: z.string().min(1), name: z.string().min(1) }),
);

const netCapabilitySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none') }),
  z.object({ mode: z.literal('any') }),
  z.object({ mode: z.literal('allowlist'), hosts: z.array(z.string()) }),
]);

/** `CapabilitySpec` from @moxxy/sdk, as wire data. Unknown keys are stripped
 *  (not refused) so an older CLI tolerates future additive fields. */
const capabilitySpecSchema = z.object({
  fs: z
    .object({
      read: z.array(z.string()).optional(),
      write: z.array(z.string()).optional(),
    })
    .optional(),
  net: netCapabilitySchema.optional(),
  env: z.array(z.string()).optional(),
  timeMs: z.number().nonnegative().optional(),
  memMb: z.number().nonnegative().optional(),
  subprocess: z.boolean().optional(),
  commands: z.array(z.string()).optional(),
});

const registryEntrySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string(),
  packageName: z.string().regex(NPM_NAME_RE, 'must be a bare npm package name'),
  installSpec: z.string().min(1),
  version: z.string().regex(EXACT_SEMVER_RE, 'must be an exact semver pin'),
  provides: providesSchema.optional(),
  capabilities: capabilitySpecSchema.optional(),
});

const registryIndexSchema = z.object({
  version: z.literal(REGISTRY_INDEX_VERSION),
  generatedAt: z.string().min(1),
  // One malformed entry refuses the WHOLE index (unlike npm-search results,
  // which skip bad entries): the maintainer signed this file as a unit, so a
  // partially-valid signed index is a publisher bug, not something to paper
  // over entry-by-entry.
  entries: z.array(registryEntrySchema).max(5000),
});

const cacheFileSchema = z.object({
  fetchedAtMs: z.number().int().nonnegative(),
  indexB64: z.string().min(1),
  sig: z.string().min(1),
});

/** One signed, pinned installable plugin. Structurally a superset of
 *  {@link PluginCatalogEntry} plus the exact `version` pin. */
export interface PluginRegistryEntry {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly packageName: string;
  readonly installSpec: string;
  /** Exact semver the signature vouches for — the install pin. */
  readonly version: string;
  readonly provides?: ReadonlyArray<{ readonly category: string; readonly name: string }>;
  /** Declared capability manifest for pre-install display + post-install comparison. */
  readonly capabilities?: CapabilitySpec;
}

export interface PluginRegistryIndex {
  readonly version: typeof REGISTRY_INDEX_VERSION;
  readonly generatedAt: string;
  readonly entries: ReadonlyArray<PluginRegistryEntry>;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * True iff `sigB64` is a valid Ed25519 signature over the exact `bytes` for
 * `publicKeyPem` (an SPKI PEM). Returns false — never throws — on malformed
 * key/signature so callers can simply fall back. Mirrors
 * `verifyManifestSignature` in desktop-host's app-update path.
 */
export function verifyRegistryIndex(
  bytes: Uint8Array,
  sigB64: string,
  publicKeyPem: string,
): boolean {
  if (!publicKeyPem || !sigB64) return false;
  try {
    const key = createPublicKey(publicKeyPem);
    return cryptoVerify(null, Buffer.from(bytes), key, Buffer.from(sigB64, 'base64'));
  } catch {
    return false;
  }
}

/** Parse + schema-check verified index bytes. Undefined on anything off. */
export function parseRegistryIndex(bytes: Uint8Array): PluginRegistryIndex | undefined {
  if (bytes.byteLength > MAX_INDEX_BYTES) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    return undefined;
  }
  const parsed = registryIndexSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

// ---------------------------------------------------------------------------
// Fetch + cache + fallback
// ---------------------------------------------------------------------------

/** Minimal byte-capable `fetch` surface, injectable for tests. The registry
 *  needs raw bytes (the signature covers them verbatim), so this is distinct
 *  from search.ts's JSON-only `FetchLike`. */
export type RegistryFetchLike = (
  url: string,
  init?: { readonly signal?: AbortSignal },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}>;

export interface RegistryFallbackReason {
  readonly code:
    | 'key-not-provisioned'
    | 'network-error'
    | 'timeout'
    | 'http-error'
    | 'bad-signature'
    | 'invalid-schema';
  readonly message: string;
}

/** A catalog-compatible entry; `version`/`capabilities` present only when it
 *  came from a verified signed index (never on fallback entries). */
export type RegistryResultEntry = PluginCatalogEntry & {
  readonly version?: string;
  readonly capabilities?: CapabilitySpec;
};

export interface SignedRegistryResult {
  /** Where the entries came from. `cache` is a verified, fresh cached index. */
  readonly source: 'remote' | 'cache' | 'fallback';
  readonly entries: ReadonlyArray<RegistryResultEntry>;
  /** Set only for `source: 'fallback'` — why the signed path was unavailable. */
  readonly reason?: RegistryFallbackReason;
}

export interface FetchSignedRegistryOptions {
  readonly fetch?: RegistryFetchLike;
  /** Index URL; default {@link DEFAULT_REGISTRY_URL}, overridable per-process
   *  via `MOXXY_REGISTRY_URL` (testing / self-hosting; not a trust decision). */
  readonly url?: string;
  /** Directory holding the cache file; default `~/.moxxy`. */
  readonly cacheDir?: string;
  /** Clock, injectable for TTL tests. */
  readonly now?: () => number;
  /** Verifying key; default the baked {@link REGISTRY_PUBLIC_KEY}. Injectable
   *  for tests — there is intentionally NO env/config override for the key. */
  readonly publicKeyPem?: string;
  /** Cancels in-flight fetches (combined with the internal 10s deadline). */
  readonly signal?: AbortSignal;
}

/**
 * Fetch the signed plugin index, preferring a fresh verified cache, and
 * degrade to the hardcoded catalog on ANY failure. Never throws.
 */
export async function fetchSignedRegistry(
  opts: FetchSignedRegistryOptions = {},
): Promise<SignedRegistryResult> {
  const publicKeyPem = opts.publicKeyPem ?? REGISTRY_PUBLIC_KEY;
  if (!publicKeyPem) {
    return fallback('key-not-provisioned', 'no registry public key baked into this build');
  }
  const now = opts.now ?? Date.now;
  const cachePath = path.join(opts.cacheDir ?? moxxyPath(), REGISTRY_CACHE_FILENAME);

  // 1. Fresh verified cache (availability/latency only — re-verified above).
  const cached = await readVerifiedCache(cachePath, publicKeyPem);
  if (cached) {
    const age = now() - cached.fetchedAtMs;
    // A future timestamp (age < 0) is treated as stale, not fresh — the
    // timestamp is outside the signature, so it must never EXTEND trust.
    if (age >= 0 && age <= REGISTRY_CACHE_TTL_MS) {
      return { source: 'cache', entries: cached.index.entries };
    }
  }

  // 2. Remote fetch, hard 10s deadline.
  const fetchImpl = opts.fetch ?? (globalThis.fetch as RegistryFetchLike | undefined);
  if (!fetchImpl) return fallback('network-error', 'no fetch implementation available');
  const url = opts.url ?? process.env.MOXXY_REGISTRY_URL ?? DEFAULT_REGISTRY_URL;
  const deadline = AbortSignal.timeout(REGISTRY_FETCH_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, deadline]) : deadline;
  let bytes: Uint8Array;
  let sig: string;
  try {
    const [indexRes, sigRes] = await Promise.all([
      fetchImpl(url, { signal }),
      fetchImpl(`${url}.sig`, { signal }),
    ]);
    if (!indexRes.ok || !sigRes.ok) {
      return fallback(
        'http-error',
        `registry fetch failed: index ${indexRes.status}, sig ${sigRes.status}`,
      );
    }
    bytes = new Uint8Array(await indexRes.arrayBuffer());
    sig = (await sigRes.text()).trim();
  } catch (err) {
    if (deadline.aborted) {
      return fallback('timeout', `registry fetch exceeded ${REGISTRY_FETCH_TIMEOUT_MS}ms`);
    }
    return fallback('network-error', err instanceof Error ? err.message : String(err));
  }

  // 3. Verify BEFORE parsing — unverified bytes get one cheap size check and
  // one signature check, nothing else.
  if (bytes.byteLength > MAX_INDEX_BYTES) {
    return fallback('invalid-schema', `index body exceeds ${MAX_INDEX_BYTES} bytes`);
  }
  if (!verifyRegistryIndex(bytes, sig, publicKeyPem)) {
    return fallback('bad-signature', 'index signature did not verify against the baked key');
  }
  const index = parseRegistryIndex(bytes);
  if (!index) {
    return fallback('invalid-schema', 'signed index failed schema validation');
  }

  // 4. Cache best-effort (bytes + sig, so the read path re-verifies).
  try {
    const cacheBody: z.infer<typeof cacheFileSchema> = {
      fetchedAtMs: now(),
      indexB64: Buffer.from(bytes).toString('base64'),
      sig,
    };
    await writeFileAtomic(cachePath, JSON.stringify(cacheBody));
  } catch {
    // A read-only home dir must not break installs.
  }
  return { source: 'remote', entries: index.entries };
}

function fallback(
  code: RegistryFallbackReason['code'],
  message: string,
): SignedRegistryResult {
  return {
    source: 'fallback',
    entries: INSTALLABLE_PLUGIN_CATALOG,
    reason: { code, message },
  };
}

async function readVerifiedCache(
  cachePath: string,
  publicKeyPem: string,
): Promise<{ fetchedAtMs: number; index: PluginRegistryIndex } | undefined> {
  let rawText: string;
  try {
    rawText = await fs.readFile(cachePath, 'utf8');
  } catch {
    return undefined;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    return undefined;
  }
  const parsed = cacheFileSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const bytes = Buffer.from(parsed.data.indexB64, 'base64');
  // Tampered cache = bytes that no longer verify → discarded, remote re-fetch.
  if (!verifyRegistryIndex(bytes, parsed.data.sig, publicKeyPem)) return undefined;
  const index = parseRegistryIndex(bytes);
  if (!index) return undefined;
  return { fetchedAtMs: parsed.data.fetchedAtMs, index };
}

// ---------------------------------------------------------------------------
// Install-source resolution (pin integration)
// ---------------------------------------------------------------------------

export interface ResolvedInstallSource {
  /** npm spec to install (hand to `installPluginPackagePinned`). */
  readonly spec: string;
  /** Resolved bare package name (status / remove bookkeeping). */
  readonly packageName: string;
  /** `signed` = verified index entry; `catalog` = hardcoded entry; `spec` =
   *  the input passed through untouched (raw npm/git/path spec). */
  readonly origin: 'signed' | 'catalog' | 'spec';
  /**
   * Exact version pin from the signed index. Present only for `signed`
   * origins whose installSpec is a plain npm name (a git/path installSpec is
   * not version-pinnable). Pin precedence at install time:
   * explicit user version > this signed pin > cliVersion lockstep > latest.
   */
  readonly pinnedVersion?: string;
  /** Declared capability manifest from the signed entry, when it carries one. */
  readonly capabilities?: CapabilitySpec;
  /** Why the signed registry was unavailable, when it was. */
  readonly registryFallback?: RegistryFallbackReason;
}

/**
 * Resolve a `moxxy plugins install <target>` / `install_plugin` target —
 * catalog id, package name, or raw spec — consulting the signed registry
 * first (when the key is provisioned), then the hardcoded catalog, then
 * passing the spec through untouched. Never throws.
 */
export async function resolveInstallSource(
  idOrSpec: string,
  opts: FetchSignedRegistryOptions = {},
): Promise<ResolvedInstallSource> {
  const registry = await fetchSignedRegistry(opts);
  if (registry.source !== 'fallback') {
    const entry = registry.entries.find(
      (e) => e.id === idOrSpec || e.packageName === idOrSpec,
    );
    if (entry) {
      // Only a plain npm-name installSpec can carry a version pin; a signed
      // git/path spec installs verbatim (its ref is its own pin).
      const pinnable = entry.version !== undefined && NPM_NAME_RE.test(entry.installSpec);
      return {
        spec: entry.installSpec,
        packageName: entry.packageName,
        origin: 'signed',
        ...(pinnable ? { pinnedVersion: entry.version } : {}),
        ...(entry.capabilities ? { capabilities: entry.capabilities } : {}),
      };
    }
  }
  const catalogEntry = resolveCatalogEntry(idOrSpec);
  if (catalogEntry) {
    return {
      spec: catalogEntry.installSpec,
      packageName: catalogEntry.packageName,
      origin: 'catalog',
      ...(registry.reason ? { registryFallback: registry.reason } : {}),
    };
  }
  return {
    spec: idOrSpec,
    packageName: idOrSpec,
    origin: 'spec',
    ...(registry.reason ? { registryFallback: registry.reason } : {}),
  };
}

// ---------------------------------------------------------------------------
// Capability-manifest comparison (warn-only in v1)
// ---------------------------------------------------------------------------

export interface CapabilityManifestCheck {
  /** True when `actual` claims ANY surface the signed manifest didn't declare. */
  readonly capabilityMismatch: boolean;
  /** Axis-by-axis description of where `actual` exceeds `declared`. */
  readonly widened: ReadonlyArray<string>;
}

const NET_RANK = { none: 0, allowlist: 1, any: 2 } as const;

/**
 * Compare a signed entry's declared capability manifest against the
 * post-install aggregate surface (`buildCapabilityReport(...).surface`).
 * Fires only on WIDENING — a package using less than it declared is fine.
 *
 * Conservative by construction: fs globs / env / commands are compared as
 * string sets (no glob-subsumption analysis), so a differently-spelled but
 * equivalent glob reads as widening. That bias is deliberate for a warn-only
 * v1 — enforcement (refusing the install) arrives with the consent phase.
 */
export function checkCapabilityManifest(
  declared: CapabilitySpec,
  actual: CapabilitySpec,
): CapabilityManifestCheck {
  const widened: string[] = [];

  const extras = (
    have: ReadonlyArray<string> | undefined,
    allowed: ReadonlyArray<string> | undefined,
  ): string[] => {
    const ok = new Set(allowed ?? []);
    return (have ?? []).filter((v) => !ok.has(v));
  };

  const extraRead = extras(actual.fs?.read, declared.fs?.read);
  if (extraRead.length) widened.push(`fs.read: ${extraRead.join(', ')}`);
  const extraWrite = extras(actual.fs?.write, declared.fs?.write);
  if (extraWrite.length) widened.push(`fs.write: ${extraWrite.join(', ')}`);

  const declaredNet = declared.net?.mode ?? 'none';
  const actualNet = actual.net?.mode ?? 'none';
  if (NET_RANK[actualNet] > NET_RANK[declaredNet]) {
    widened.push(`net: ${actualNet} (declared: ${declaredNet})`);
  } else if (actual.net?.mode === 'allowlist' && declared.net?.mode === 'allowlist') {
    const extraHosts = extras(actual.net.hosts, declared.net.hosts);
    if (extraHosts.length) widened.push(`net.hosts: ${extraHosts.join(', ')}`);
  }

  const extraEnv = extras(actual.env, declared.env);
  if (extraEnv.length) widened.push(`env: ${extraEnv.join(', ')}`);

  if (actual.subprocess && !declared.subprocess) {
    widened.push('subprocess (not declared)');
  } else if (actual.subprocess && declared.subprocess) {
    // An absent/empty command list under subprocess:true means UNRESTRICTED,
    // so "no commands" is wider than any allowlist — not narrower.
    const declaredUnrestricted = !declared.commands?.length;
    const actualUnrestricted = !actual.commands?.length;
    if (!declaredUnrestricted) {
      if (actualUnrestricted) {
        widened.push(`commands: unrestricted (declared: ${(declared.commands ?? []).join(', ')})`);
      } else {
        const extraCmds = extras(actual.commands, declared.commands);
        if (extraCmds.length) widened.push(`commands: ${extraCmds.join(', ')}`);
      }
    }
  }

  // Budgets: a declared ceiling the actual surface exceeds (or drops — no
  // budget means unbounded) is a widening. No declared ceiling = no bound.
  if (declared.timeMs !== undefined && (actual.timeMs === undefined || actual.timeMs > declared.timeMs)) {
    widened.push(`timeMs: ${actual.timeMs ?? 'unbounded'} (declared: ${declared.timeMs})`);
  }
  if (declared.memMb !== undefined && (actual.memMb === undefined || actual.memMb > declared.memMb)) {
    widened.push(`memMb: ${actual.memMb ?? 'unbounded'} (declared: ${declared.memMb})`);
  }

  return { capabilityMismatch: widened.length > 0, widened };
}
