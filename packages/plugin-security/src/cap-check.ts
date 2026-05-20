import * as path from 'node:path';
import type { CapabilitySpec, FsCapability, NetCapability } from '@moxxy/sdk';

/**
 * Static, pure helpers that decide whether a tool input is consistent
 * with a declared `CapabilitySpec`. The `inproc` isolator calls these
 * before running the handler; richer isolators (worker/subprocess/...)
 * can reuse them server-side after marshalling.
 *
 * These checks are pessimistic — when uncertain we deny, because a
 * false-allow undermines the whole point of opting in.
 */

export interface CapCheckResult {
  readonly ok: boolean;
  /** Human-readable reason. Empty when `ok` is true. */
  readonly reason: string;
}

const OK: CapCheckResult = Object.freeze({ ok: true, reason: '' });

const fail = (reason: string): CapCheckResult => ({ ok: false, reason });

/**
 * Walk the input looking for string fields that look like absolute
 * paths or `file://` URLs and validate them against the declared
 * `fs.read` / `fs.write` globs. We don't try to be smart about which
 * key means read vs. write — we union both sides of the cap and check
 * every path-shaped string is covered by something. The tool is the
 * authority on what it actually does at runtime.
 */
export function checkFsCap(
  input: unknown,
  cap: FsCapability | undefined,
  cwd: string,
): CapCheckResult {
  const paths = extractPaths(input);
  if (paths.length === 0) return OK;

  if (!cap || (!cap.read && !cap.write)) {
    return fail(
      `tool received path-like inputs (${paths.slice(0, 3).join(', ')}…) ` +
        `but declared no fs capability`,
    );
  }
  const patterns = [...(cap.read ?? []), ...(cap.write ?? [])].map((p) =>
    resolvePattern(p, cwd),
  );

  for (const p of paths) {
    const abs = path.isAbsolute(p) ? path.normalize(p) : path.resolve(cwd, p);
    if (!patterns.some((pat) => matchesGlob(abs, pat))) {
      return fail(`path '${p}' is outside the tool's declared fs capability`);
    }
  }
  return OK;
}

/**
 * Validate that any URL-shaped strings in the input are reachable
 * under the declared `net` capability. URL-detection follows the same
 * "look at every string field" heuristic as fs.
 */
export function checkNetCap(input: unknown, cap: NetCapability | undefined): CapCheckResult {
  const urls = extractUrls(input);
  if (urls.length === 0) return OK;

  if (!cap || cap.mode === 'none') {
    return fail(`tool received URL inputs but its capability declares no network access`);
  }
  if (cap.mode === 'any') return OK;
  // allowlist
  for (const u of urls) {
    let host: string;
    try {
      host = new URL(u).hostname;
    } catch {
      return fail(`unparseable URL in input: ${u}`);
    }
    if (!cap.hosts.some((h) => hostMatches(host, h))) {
      return fail(`host '${host}' not in the tool's declared net allowlist`);
    }
  }
  return OK;
}

/**
 * Build a snapshot of the env keys the handler is allowed to read.
 * Returned object can be passed to the handler in place of full
 * `process.env`. The `inproc` isolator can't actually constrain what
 * the handler reads (it's in-process), so this is informational here
 * but real once we ship a `subprocess` isolator that spawns with this
 * env explicitly.
 */
export function maskEnv(
  env: Readonly<Record<string, string | undefined>>,
  allow: ReadonlyArray<string> | undefined,
): Record<string, string | undefined> {
  const masked: Record<string, string | undefined> = {};
  for (const key of allow ?? []) {
    if (key in env) masked[key] = env[key];
  }
  return masked;
}

// ---------- helpers ----------

const PATH_KEY = /\b(path|paths|file|files|filename|dir|directory|cwd|out|output)\b/i;
const URL_KEY = /\b(url|uri|endpoint|href|src)\b/i;

function extractPaths(input: unknown): string[] {
  const out: string[] = [];
  walkStrings(input, (key, value) => {
    if (PATH_KEY.test(key)) out.push(value);
    else if (value.startsWith('file://')) out.push(value.slice('file://'.length));
    else if (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)) out.push(value);
  });
  return out;
}

function extractUrls(input: unknown): string[] {
  const out: string[] = [];
  walkStrings(input, (key, value) => {
    if (URL_KEY.test(key) && /^https?:\/\//.test(value)) out.push(value);
    else if (/^https?:\/\//.test(value)) out.push(value);
  });
  return out;
}

function walkStrings(
  node: unknown,
  visit: (key: string, value: string) => void,
  parentKey = '',
): void {
  if (typeof node === 'string') {
    visit(parentKey, node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) walkStrings(item, visit, parentKey);
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) walkStrings(v, visit, k);
  }
}

function resolvePattern(pattern: string, cwd: string): string {
  if (pattern.startsWith('$cwd')) return path.normalize(cwd + pattern.slice('$cwd'.length));
  if (pattern.startsWith('~/')) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    return path.normalize(home + pattern.slice(1));
  }
  return path.isAbsolute(pattern) ? path.normalize(pattern) : path.resolve(cwd, pattern);
}

/**
 * Minimal glob matcher: `**` matches across slashes, `*` matches within
 * a path segment, everything else is literal. Adequate for capability
 * declarations; this isn't user-facing fnmatch.
 */
function matchesGlob(p: string, pattern: string): boolean {
  // Anchor and escape; convert ** → .*, * → [^/]*.
  const re =
    '^' +
    pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '<<DOUBLESTAR>>')
      .replace(/\*/g, '[^/]*')
      .replace(/<<DOUBLESTAR>>/g, '.*') +
    '$';
  return new RegExp(re).test(p);
}

/**
 * Hostname match: exact match, or `*.example.com` matches any subdomain.
 */
function hostMatches(host: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1);
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return host === pattern;
}

/** Run every cap check; return the first failure or OK. */
export function checkAllCaps(
  input: unknown,
  caps: CapabilitySpec,
  cwd: string,
): CapCheckResult {
  const fsResult = checkFsCap(input, caps.fs, cwd);
  if (!fsResult.ok) return fsResult;
  const netResult = checkNetCap(input, caps.net);
  if (!netResult.ok) return netResult;
  return OK;
}
