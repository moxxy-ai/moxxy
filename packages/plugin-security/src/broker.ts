import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import type { CapabilitySpec } from '@moxxy/sdk';
import { pathInScope, urlInScope } from './cap-check.js';

/**
 * Hard ceiling on bytes the broker will buffer for a single exec / fetch
 * before it aborts and rejects. The broker is the trust boundary for
 * sandboxed tools, so it bounds its own memory use rather than trusting
 * the (potentially hostile) child process or remote server to behave.
 *
 * 8 MB is generous for the broker's intended use (reading command output
 * / small HTTP bodies) while still capping a `yes | head`-style flood long
 * before it can OOM the host.
 */
const MAX_BROKER_OUTPUT_BYTES = 8 * 1024 * 1024;

/** Grace after a SIGTERM before escalating to an unignorable SIGKILL. A child
 *  that traps/ignores SIGTERM (e.g. `trap '' TERM`) would otherwise keep the
 *  broker request pending forever; this guarantees the kill lands. */
const BROKER_KILL_GRACE_MS = 2000;

/**
 * Maximum number of HTTP redirect hops `brokerFetch` will follow. Each hop's
 * target is re-validated against the tool's `caps.net` allowlist before it is
 * followed (see {@link brokerFetch}); this bound just stops a redirect loop
 * from spinning forever.
 */
const MAX_FETCH_REDIRECTS = 5;

/**
 * Node module specifiers that worker / subprocess isolators must
 * BLOCK from the handler's import graph. These are the modules whose
 * existence undermines the broker: a handler that imports `node:fs`
 * directly can read anywhere the process can, bypassing every
 * declared `caps.fs` rule.
 *
 * The list intentionally covers both `node:` prefixed and bare
 * specifiers (Node accepts `import 'fs'` and `import 'node:fs'`
 * interchangeably).
 *
 * The list does NOT include modules the shims themselves need
 * (`node:module`, `node:worker_threads`, `node:process`) — those are
 * imported by the shim BEFORE the loader is registered, so the
 * loader never sees them.
 */
export const BLOCKED_HANDLER_MODULES: ReadonlyArray<string> = Object.freeze([
  'node:fs',
  'node:fs/promises',
  'node:child_process',
  'node:net',
  'node:dgram',
  'node:http',
  'node:http2',
  'node:https',
  'node:tls',
  // Bare specifiers (Node treats these as aliases)
  'fs',
  'fs/promises',
  'child_process',
  'net',
  'dgram',
  'http',
  'http2',
  'https',
  'tls',
]);

/**
 * Source of an ESM loader hook that throws on any blocked-module
 * specifier. Encoded into a `data:` URL and registered via
 * `module.register()` at the start of each worker / subprocess
 * handler invocation. Inline so the shim doesn't need an extra
 * file shipped at a stable path.
 *
 * The hook only sees imports performed AFTER `register()` is called
 * — by design, the shim does its own setup (e.g. `import { parentPort
 * } from 'node:worker_threads'`) before registering the loader, so
 * the shim's needs are not blocked.
 */
export const LOADER_HOOK_SOURCE = `
const BLOCKED = new Set(${JSON.stringify(BLOCKED_HANDLER_MODULES)});
export async function resolve(specifier, context, nextResolve) {
  if (BLOCKED.has(specifier)) {
    throw new Error(
      "[security:loader] blocked import: " + specifier +
      " — use ctx.fs / ctx.fetch / ctx.exec instead of importing Node APIs directly."
    );
  }
  return nextResolve(specifier, context);
}
`;

/**
 * Transport-agnostic capability broker. Lives in `@moxxy/plugin-security`
 * because every isolator that brokers (worker, subprocess, wasm) shares
 * the same protocol — only the transport (postMessage, NDJSON over
 * stdio, host imports) differs.
 *
 * The set of ops here is the *boundary* of what brokered tools can do
 * to the host. Adding a new op = explicitly extending that boundary.
 * Don't pass through env mutation, raw socket access, or anything else
 * without a deliberate scope decision.
 */

export type BrokerOp =
  | 'fs.readFile'
  | 'fs.writeFile'
  | 'fs.readdir'
  | 'fs.stat'
  | 'fetch'
  | 'exec';

export interface BrokerRequest {
  readonly type: 'broker-request';
  readonly id: number;
  readonly op: BrokerOp;
  readonly args: ReadonlyArray<unknown>;
}

export type BrokerResponse =
  | { readonly type: 'broker-response'; readonly id: number; readonly ok: true; readonly value: unknown }
  | {
      readonly type: 'broker-response';
      readonly id: number;
      readonly ok: false;
      readonly errorName: string;
      readonly errorMessage: string;
    };

export interface BrokerContext {
  readonly caps: CapabilitySpec;
  readonly cwd: string;
  readonly signal: AbortSignal;
}

/**
 * Execute a single broker request. Pure (no transport); the isolator
 * wires the response back over its channel.
 */
export async function handleBrokerRequest(
  req: BrokerRequest,
  ctx: BrokerContext,
): Promise<BrokerResponse> {
  try {
    const value = await dispatch(req, ctx);
    return { type: 'broker-response', id: req.id, ok: true, value };
  } catch (err) {
    const e = err as Error;
    return {
      type: 'broker-response',
      id: req.id,
      ok: false,
      errorName: e.name ?? 'Error',
      errorMessage: e.message ?? String(err),
    };
  }
}

async function dispatch(req: BrokerRequest, ctx: BrokerContext): Promise<unknown> {
  switch (req.op) {
    case 'fs.readFile':
      return brokerReadFile(req.args, ctx);
    case 'fs.writeFile':
      return brokerWriteFile(req.args, ctx);
    case 'fs.readdir':
      return brokerReaddir(req.args, ctx);
    case 'fs.stat':
      return brokerStat(req.args, ctx);
    case 'fetch':
      return brokerFetch(req.args, ctx);
    case 'exec':
      return brokerExec(req.args, ctx);
    default: {
      const _exhaustive: never = req.op;
      throw new Error(`[broker] unknown op: ${String(_exhaustive)}`);
    }
  }
}

// ---------- fs ops ----------

/**
 * Re-validate a path against the declared fs scope AFTER resolving symlinks.
 *
 * `pathInScope` is purely lexical: it normalizes the string and matches it
 * against the cap globs, but never touches the filesystem. That leaves a
 * symlink escape — a path that lexically sits inside scope (`$cwd/link`) can
 * point at `/etc/passwd` — and a TOCTOU window between the check and the
 * syscall. This closes both for paths that already exist by resolving the
 * real (canonical, symlink-free) path and re-checking THAT against the same
 * globs.
 *
 * Conservative by construction: a path that legitimately resolves to a target
 * inside scope still passes; only a real path that escapes scope is rejected.
 * For ops on not-yet-existing targets (write/mkdir) the deepest existing
 * ancestor is canonicalized instead, so a symlinked parent dir can't smuggle
 * the write out of scope.
 *
 * Returns the canonical path the caller should hand to the syscall, so the
 * op operates on exactly what was validated (shrinking the residual race).
 */
async function realpathInScope(
  filePath: string,
  caps: CapabilitySpec,
  cwd: string,
  mode: 'read' | 'write',
  label: string,
): Promise<string> {
  // Lexical gate first (cheap, and rejects obvious out-of-scope inputs).
  if (!pathInScope(filePath, caps.fs, cwd, mode)) {
    throw new Error(
      `[${label}] path '${filePath}' is outside the tool's declared fs.${mode} capability`,
    );
  }
  const abs = path.isAbsolute(filePath) ? path.normalize(filePath) : path.resolve(cwd, filePath);
  // Resolve the real, symlink-free path. If the target itself doesn't exist
  // yet (a write/mkdir destination), canonicalize the nearest existing
  // ancestor and re-append the remainder — a symlinked parent still gets
  // caught, while a brand-new leaf file is allowed.
  let real: string;
  try {
    real = await fs.realpath(abs);
  } catch {
    real = await realpathDeepest(abs);
  }
  // Fast path: realpath unchanged → lexical check already vetted it.
  if (real === abs) return real;
  // The path traversed a symlink. Re-validate the REAL location, comparing it
  // against the CANONICALIZED scope roots. Canonicalizing both sides is what
  // keeps benign system symlinks in the scope prefix from causing false
  // rejections (e.g. macOS resolves `/var`→`/private/var` and `/tmp`→`/private/
  // /tmp`; a glob of `${tmpdir}/**` must still match a file whose realpath now
  // carries the `/private` prefix). A genuine escape — `$cwd/link → /etc/passwd`
  // — canonicalizes to a root NOT under any allowed scope and is rejected.
  const globs = mode === 'read' ? caps.fs?.read : caps.fs?.write;
  const allowed = await canonicalScopeRoots(globs ?? [], cwd);
  if (!allowed.some((root) => isWithin(real, root))) {
    throw new Error(
      `[${label}] path '${filePath}' resolves (via symlink) to '${real}', ` +
        `outside the tool's declared fs.${mode} capability`,
    );
  }
  return real;
}

/**
 * For each declared glob, take the literal directory prefix (everything before
 * the first wildcard), resolve it relative to cwd / `$cwd` / `~`, and
 * canonicalize it via realpath (resolving the same system symlinks the target
 * goes through). These are the symlink-free roots a realpath'd target must sit
 * under to be in scope.
 */
async function canonicalScopeRoots(
  globs: ReadonlyArray<string>,
  cwd: string,
): Promise<ReadonlyArray<string>> {
  const roots: string[] = [];
  for (const glob of globs) {
    const expanded = expandPattern(glob, cwd);
    const wildcard = expanded.search(/[*?[]/);
    const literal = wildcard === -1 ? expanded : expanded.slice(0, wildcard);
    // Base = the directory portion of the literal prefix.
    const base = literal.endsWith(path.sep) ? literal.slice(0, -1) : path.dirname(literal);
    const normalized = path.normalize(base || path.sep);
    try {
      roots.push(await fs.realpath(normalized));
    } catch {
      roots.push(await realpathDeepest(normalized));
    }
  }
  return roots;
}

/** Resolve `$cwd` / `~` / relative globs to an absolute lexical path. */
function expandPattern(pattern: string, cwd: string): string {
  if (pattern.startsWith('$cwd')) return path.normalize(cwd + pattern.slice('$cwd'.length));
  if (pattern.startsWith('~/')) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    return path.normalize(home + pattern.slice(1));
  }
  return path.isAbsolute(pattern) ? path.normalize(pattern) : path.resolve(cwd, pattern);
}

/** True when `child` is `root` itself or a descendant of it. */
function isWithin(child: string, root: string): boolean {
  if (child === root) return true;
  const withSep = root.endsWith(path.sep) ? root : root + path.sep;
  return child.startsWith(withSep);
}

/**
 * Canonicalize the deepest existing ancestor of `abs`, then re-join the
 * non-existent remainder. Used when the target path doesn't exist yet so a
 * symlinked parent directory can't move a write/mkdir out of scope.
 */
async function realpathDeepest(abs: string): Promise<string> {
  const parts = abs.split(path.sep);
  for (let i = parts.length; i > 0; i--) {
    const candidate = parts.slice(0, i).join(path.sep) || path.sep;
    try {
      const real = await fs.realpath(candidate);
      const remainder = parts.slice(i);
      return remainder.length ? path.join(real, ...remainder) : real;
    } catch {
      // ancestor doesn't exist either; keep walking up
    }
  }
  return abs;
}

async function brokerReadFile(
  args: ReadonlyArray<unknown>,
  { caps, cwd }: BrokerContext,
): Promise<string> {
  const filePath = args[0];
  if (typeof filePath !== 'string') {
    throw new Error('[broker:fs.readFile] expected (path: string) at args[0]');
  }
  const real = await realpathInScope(filePath, caps, cwd, 'read', 'broker:fs.readFile');
  const opts = (args[1] ?? {}) as { encoding?: BufferEncoding };
  const buf = await fs.readFile(real);
  return buf.toString(opts.encoding ?? 'utf8');
}

async function brokerWriteFile(
  args: ReadonlyArray<unknown>,
  { caps, cwd }: BrokerContext,
): Promise<void> {
  const filePath = args[0];
  const data = args[1];
  if (typeof filePath !== 'string') {
    throw new Error('[broker:fs.writeFile] expected (path: string) at args[0]');
  }
  if (typeof data !== 'string') {
    throw new Error('[broker:fs.writeFile] expected (data: string) at args[1]');
  }
  const real = await realpathInScope(filePath, caps, cwd, 'write', 'broker:fs.writeFile');
  await fs.mkdir(path.dirname(real), { recursive: true });
  await fs.writeFile(real, data, 'utf8');
}

async function brokerReaddir(
  args: ReadonlyArray<unknown>,
  { caps, cwd }: BrokerContext,
): Promise<ReadonlyArray<string>> {
  const dirPath = args[0];
  if (typeof dirPath !== 'string') {
    throw new Error('[broker:fs.readdir] expected (path: string) at args[0]');
  }
  const real = await realpathInScope(dirPath, caps, cwd, 'read', 'broker:fs.readdir');
  return await fs.readdir(real);
}

interface StatResult {
  readonly size: number;
  readonly mtimeMs: number;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
}

async function brokerStat(
  args: ReadonlyArray<unknown>,
  { caps, cwd }: BrokerContext,
): Promise<StatResult> {
  const filePath = args[0];
  if (typeof filePath !== 'string') {
    throw new Error('[broker:fs.stat] expected (path: string) at args[0]');
  }
  const real = await realpathInScope(filePath, caps, cwd, 'read', 'broker:fs.stat');
  const st = await fs.stat(real);
  return {
    size: st.size,
    mtimeMs: st.mtimeMs,
    isFile: st.isFile(),
    isDirectory: st.isDirectory(),
  };
}

// ---------- net ----------

interface FetchResult {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

async function brokerFetch(
  args: ReadonlyArray<unknown>,
  { caps, signal }: BrokerContext,
): Promise<FetchResult> {
  const url = args[0];
  if (typeof url !== 'string') {
    throw new Error('[broker:fetch] expected (url: string) at args[0]');
  }
  if (!urlInScope(url, caps.net)) {
    throw new Error(
      `[broker:fetch] URL '${url}' is outside the tool's declared net capability`,
    );
  }
  const init = (args[1] ?? {}) as {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };

  // Follow redirects MANUALLY so every hop's target is re-validated against
  // the same `caps.net` allowlist. With the default `redirect:'follow'`, an
  // allowlisted host could 30x-redirect to an internal/forbidden target
  // (e.g. http://169.254.169.254/ cloud metadata or http://localhost) and the
  // broker would silently follow it — defeating the whole point of the
  // allowlist. We re-run `urlInScope` on each Location before following, and
  // cap the hop count so a redirect loop can't spin forever.
  let current = url;
  let res: Response;
  for (let hop = 0; ; hop++) {
    res = await fetch(current, {
      method: init.method ?? 'GET',
      ...(init.headers ? { headers: init.headers } : {}),
      ...(init.body !== undefined ? { body: init.body } : {}),
      redirect: 'manual',
      signal,
    });
    // 3xx with a Location → a redirect we must re-validate before following.
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) break;
    if (hop >= MAX_FETCH_REDIRECTS) {
      throw new Error(
        `[broker:fetch] too many redirects (>${MAX_FETCH_REDIRECTS}) starting from '${url}'`,
      );
    }
    // Resolve relative Location values against the current URL.
    let next: string;
    try {
      next = new URL(location, current).toString();
    } catch {
      throw new Error(`[broker:fetch] redirect to unparseable Location '${location}'`);
    }
    if (!urlInScope(next, caps.net)) {
      throw new Error(
        `[broker:fetch] redirect target '${next}' is outside the tool's declared net capability`,
      );
    }
    current = next;
  }

  const body = await readBodyCapped(res, MAX_BROKER_OUTPUT_BYTES, url);
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k] = v;
  });
  return {
    status: res.status,
    statusText: res.statusText,
    headers,
    body,
  };
}

/**
 * Read a response body as UTF-8 text but reject once it exceeds `maxBytes`,
 * so a hostile (or merely huge) server within the allowlist can't stream
 * gigabytes and OOM the host. `res.text()` would buffer the whole thing
 * unbounded; this streams and aborts early.
 */
async function readBodyCapped(res: Response, maxBytes: number, url: string): Promise<string> {
  const reader = res.body?.getReader();
  // No streamable body (e.g. empty 204/304) → fall back to text(); it can't
  // exceed the cap because there's nothing to read.
  if (!reader) return res.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          throw new Error(
            `[broker:fetch] response body from '${url}' exceeded the ${maxBytes}-byte limit`,
          );
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// ---------- subprocess (exec) ----------

interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

// Minimal POSIX-friendly default, matching the subprocess isolator's DEFAULT_ENV.
const BROKER_DEFAULT_ENV: ReadonlyArray<string> = ['PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'TERM'];

/**
 * Curate the env a brokered subprocess inherits: only the keys in the tool's
 * `caps.env` allowlist (or a minimal default), plus any explicit per-call
 * `env`. Never the full parent `process.env` — that would leak the host's
 * secrets into the child.
 *
 * Exported so every isolator that spawns a child (e.g. the wasm broker's
 * synchronous `spawnSync`) curates env the same way instead of inheriting
 * the full `process.env`.
 */
export function buildBrokerEnv(
  caps: { env?: ReadonlyArray<string> },
  optsEnv: Record<string, string> | undefined,
): Record<string, string> {
  const allow = caps.env ?? BROKER_DEFAULT_ENV;
  const env: Record<string, string> = {};
  for (const key of allow) {
    const v = process.env[key];
    if (v !== undefined) env[key] = v;
  }
  return { ...env, ...(optsEnv ?? {}) };
}

async function brokerExec(
  args: ReadonlyArray<unknown>,
  { caps, cwd, signal }: BrokerContext,
): Promise<ExecResult> {
  if (!caps.subprocess) {
    throw new Error(
      `[broker:exec] tool's capability spec does not include subprocess: true`,
    );
  }
  const command = args[0];
  if (typeof command !== 'string') {
    throw new Error('[broker:exec] expected (command: string) at args[0]');
  }
  const argv = (args[1] ?? []) as ReadonlyArray<string>;
  const opts = (args[2] ?? {}) as { cwd?: string; env?: Record<string, string>; timeoutMs?: number };

  // Optional command allowlist. When `caps.commands` is set, the command
  // basename (or absolute path) must appear in the list.
  const allowlist = caps.commands;
  if (allowlist && allowlist.length > 0) {
    const base = path.basename(command);
    if (!allowlist.includes(base) && !allowlist.includes(command)) {
      throw new Error(
        `[broker:exec] command '${command}' is outside the tool's declared commands allowlist`,
      );
    }
  }

  return await new Promise<ExecResult>((resolve, reject) => {
    const child = spawn(command, [...argv], {
      cwd: opts.cwd ?? cwd,
      // Filter the parent env through the tool's `caps.env` allowlist (or a
      // minimal default) instead of leaking ALL of process.env — which would
      // hand the brokered subprocess every API key/token the host holds. This
      // mirrors the subprocess isolator's own env curation.
      env: buildBrokerEnv(caps, opts.env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    // Send SIGTERM, then schedule an unignorable SIGKILL so a child that traps
    // SIGTERM can't wedge the request. `clearKill` (on 'close'/'error') cancels
    // the escalation once the child is confirmed gone, so a child that exits
    // cleanly is never SIGKILLed post-mortem.
    const terminate = (): void => {
      child.kill('SIGTERM');
      if (killTimer) return;
      killTimer = setTimeout(() => child.kill('SIGKILL'), BROKER_KILL_GRACE_MS);
      killTimer.unref?.();
    };
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          terminate();
          finish(() =>
            reject(new Error(`[broker:exec] '${command}' exceeded ${opts.timeoutMs}ms`)),
          );
        }, opts.timeoutMs)
      : null;
    const onAbort = (): void => {
      // Settle the promise NOW rather than waiting for 'close' — a trapped child
      // may never emit it. The SIGKILL fallback still guarantees the child dies.
      terminate();
      finish(() => reject(new Error(`[broker:exec] '${command}' aborted`)));
    };
    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      // Deliberately do NOT clear killTimer here: when we settle via abort or
      // timeout the child may still be alive, and the scheduled SIGKILL is what
      // guarantees it dies. It's cleared instead when 'close'/'error' confirm
      // the child is actually gone (see below).
      signal.removeEventListener('abort', onAbort);
      settle();
    };
    const clearKill = (): void => {
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
    };
    // Bound the buffered output so a brokered process can't stream gigabytes
    // (e.g. `yes | head -c …`) and OOM the host. Kill the child and reject the
    // moment the combined stdout+stderr crosses the cap.
    const accumulate = (chunks: Buffer[], b: Buffer): void => {
      if (settled) return;
      total += b.byteLength;
      if (total > MAX_BROKER_OUTPUT_BYTES) {
        terminate();
        finish(() =>
          reject(
            new Error(
              `[broker:exec] '${command}' output exceeded the ${MAX_BROKER_OUTPUT_BYTES}-byte limit`,
            ),
          ),
        );
        return;
      }
      chunks.push(b);
    };
    child.stdout.on('data', (b: Buffer) => accumulate(outChunks, b));
    child.stderr.on('data', (b: Buffer) => accumulate(errChunks, b));
    signal.addEventListener('abort', onAbort, { once: true });
    child.on('error', (e: Error) => {
      clearKill();
      finish(() => reject(e));
    });
    child.on('close', (exitCode) => {
      clearKill();
      finish(() =>
        resolve({
          stdout: Buffer.concat(outChunks).toString('utf8'),
          stderr: Buffer.concat(errChunks).toString('utf8'),
          exitCode,
        }),
      );
    });
  });
}
