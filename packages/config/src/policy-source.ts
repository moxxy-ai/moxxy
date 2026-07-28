import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import type { PolicyBundle, PolicyBundleRule } from './policy-bundle.js';
import { verifyPolicyBundle } from './policy-bundle.js';
import type { PolicyBundleRef } from './schema.js';

const FETCH_TIMEOUT_MS = 10_000;

export interface PolicySourceRecord {
  readonly id: string;
  readonly revision: string;
  readonly url: string;
  readonly from: 'remote' | 'cache';
  /** Set when the remote was unusable and the cached copy carried the session. */
  readonly staleReason?: string;
}

export interface LoadedPolicy {
  readonly allow: ReadonlyArray<PolicyBundleRule>;
  readonly deny: ReadonlyArray<PolicyBundleRule>;
  readonly sources: ReadonlyArray<PolicySourceRecord>;
}

export class PolicyLoadError extends Error {
  constructor(
    readonly url: string,
    readonly reason: string,
  ) {
    super(
      `policy bundle ${url} could not be loaded: ${reason}. ` +
        'Refusing to start: a machine configured for a policy must not run without it. ' +
        'Remove it from `policy.bundles` to run without this policy deliberately.',
    );
    this.name = 'PolicyLoadError';
  }
}

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}>;

export interface LoadPolicyOptions {
  readonly fetch?: FetchLike;
  readonly cacheDir?: string;
  readonly now?: () => number;
}

const cacheFileFor = (dir: string, url: string): string =>
  path.join(dir, `${createHash('sha256').update(url).digest('hex').slice(0, 32)}.json`);

/**
 * Fetch, verify and merge every configured policy bundle.
 *
 * Fails CLOSED, which is the one place this deliberately diverges from the
 * plugin registry. The registry degrades to "you cannot install right now",
 * an inconvenience. A policy that fails to load degrades to "this host runs
 * without the rules it was configured to enforce", which is the exact
 * condition the feature exists to prevent, and it would be invisible. So an
 * unreachable bundle with no verified cache aborts startup rather than
 * quietly widening what the agent may do.
 */
export async function loadPolicyBundles(
  refs: ReadonlyArray<PolicyBundleRef>,
  opts: LoadPolicyOptions = {},
): Promise<LoadedPolicy> {
  const allow: PolicyBundleRule[] = [];
  const deny: PolicyBundleRule[] = [];
  const sources: PolicySourceRecord[] = [];
  if (refs.length === 0) return { allow, deny, sources };

  const cacheDir = opts.cacheDir ?? path.join(os.homedir(), '.moxxy', 'policy');
  await fs.mkdir(cacheDir, { recursive: true, mode: 0o700 }).catch(() => undefined);

  for (const ref of refs) {
    const cachePath = cacheFileFor(cacheDir, ref.url);
    const remote = await fetchBundle(ref, opts);

    let bundle: PolicyBundle | undefined = remote.bundle;
    let from: 'remote' | 'cache' = 'remote';
    let staleReason: string | undefined;

    if (bundle) {
      await writeCache(cachePath, remote.bytes!, remote.sig!);
    } else {
      // The cached bytes are re-verified against the configured key on every
      // read, so a cache an attacker can write is worth no more than one they
      // cannot: tampering fails the signature and the bundle is discarded.
      const cached = await readVerifiedCache(cachePath, ref);
      if (!cached) throw new PolicyLoadError(ref.url, remote.reason ?? 'unavailable');
      bundle = cached;
      from = 'cache';
      staleReason = remote.reason;
    }

    allow.push(...(bundle.permissions?.allow ?? []));
    deny.push(...(bundle.permissions?.deny ?? []));
    sources.push({
      id: bundle.id,
      revision: bundle.revision,
      url: ref.url,
      from,
      ...(staleReason ? { staleReason } : {}),
    });
  }

  return { allow, deny, sources };
}

async function fetchBundle(
  ref: PolicyBundleRef,
  opts: LoadPolicyOptions,
): Promise<{ bundle?: PolicyBundle; bytes?: Uint8Array; sig?: string; reason?: string }> {
  const fetchImpl = opts.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!fetchImpl) return { reason: 'no fetch implementation available' };

  const deadline = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let bytes: Uint8Array;
  let sig: string;
  try {
    const [bodyRes, sigRes] = await Promise.all([
      fetchImpl(ref.url, { signal: deadline }),
      fetchImpl(`${ref.url}.sig`, { signal: deadline }),
    ]);
    if (!bodyRes.ok || !sigRes.ok) {
      return { reason: `http ${bodyRes.status} / sig ${sigRes.status}` };
    }
    bytes = new Uint8Array(await bodyRes.arrayBuffer());
    sig = (await sigRes.text()).trim();
  } catch (err) {
    if (deadline.aborted) return { reason: `fetch exceeded ${FETCH_TIMEOUT_MS}ms` };
    return { reason: err instanceof Error ? err.message : String(err) };
  }

  const result = verifyPolicyBundle(bytes, sig, ref.publicKey, ref.id);
  if (!result.ok || !result.bundle) {
    // A bad signature is never treated as "unavailable": falling back to cache
    // here would let anyone who can answer for the URL pin a fleet to an old
    // policy forever by serving garbage.
    throw new PolicyLoadError(ref.url, `${result.failure}: ${result.detail ?? ''}`.trim());
  }
  return { bundle: result.bundle, bytes, sig };
}

async function writeCache(cachePath: string, bytes: Uint8Array, sig: string): Promise<void> {
  const payload = JSON.stringify({ bytes: Buffer.from(bytes).toString('base64'), sig });
  await fs.writeFile(cachePath, payload, { mode: 0o600 }).catch(() => undefined);
}

async function readVerifiedCache(
  cachePath: string,
  ref: PolicyBundleRef,
): Promise<PolicyBundle | undefined> {
  try {
    const raw = JSON.parse(await fs.readFile(cachePath, 'utf8')) as {
      bytes?: string;
      sig?: string;
    };
    if (typeof raw.bytes !== 'string' || typeof raw.sig !== 'string') return undefined;
    const result = verifyPolicyBundle(
      new Uint8Array(Buffer.from(raw.bytes, 'base64')),
      raw.sig,
      ref.publicKey,
      ref.id,
    );
    return result.ok ? result.bundle : undefined;
  } catch {
    return undefined;
  }
}
