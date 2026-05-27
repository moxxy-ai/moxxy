import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import type { CapabilitySpec } from '@moxxy/sdk';
import { pathInScope, urlInScope } from './cap-check.js';

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

async function brokerReadFile(
  args: ReadonlyArray<unknown>,
  { caps, cwd }: BrokerContext,
): Promise<string> {
  const filePath = args[0];
  if (typeof filePath !== 'string') {
    throw new Error('[broker:fs.readFile] expected (path: string) at args[0]');
  }
  if (!pathInScope(filePath, caps.fs, cwd, 'read')) {
    throw new Error(
      `[broker:fs.readFile] path '${filePath}' is outside the tool's declared fs.read capability`,
    );
  }
  const opts = (args[1] ?? {}) as { encoding?: BufferEncoding };
  const buf = await fs.readFile(filePath);
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
  if (!pathInScope(filePath, caps.fs, cwd, 'write')) {
    throw new Error(
      `[broker:fs.writeFile] path '${filePath}' is outside the tool's declared fs.write capability`,
    );
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, data, 'utf8');
}

async function brokerReaddir(
  args: ReadonlyArray<unknown>,
  { caps, cwd }: BrokerContext,
): Promise<ReadonlyArray<string>> {
  const dirPath = args[0];
  if (typeof dirPath !== 'string') {
    throw new Error('[broker:fs.readdir] expected (path: string) at args[0]');
  }
  if (!pathInScope(dirPath, caps.fs, cwd, 'read')) {
    throw new Error(
      `[broker:fs.readdir] path '${dirPath}' is outside the tool's declared fs.read capability`,
    );
  }
  return await fs.readdir(dirPath);
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
  if (!pathInScope(filePath, caps.fs, cwd, 'read')) {
    throw new Error(
      `[broker:fs.stat] path '${filePath}' is outside the tool's declared fs.read capability`,
    );
  }
  const st = await fs.stat(filePath);
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
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    ...(init.headers ? { headers: init.headers } : {}),
    ...(init.body !== undefined ? { body: init.body } : {}),
    signal,
  });
  const body = await res.text();
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
 */
function buildBrokerEnv(
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

  // Optional command allowlist. When `caps.commands` is set, the
  // command basename must appear in the list. Untyped on CapabilitySpec
  // for now — we read it dynamically so older capability declarations
  // without `commands` still compile against this broker.
  const allowlist = (caps as unknown as { commands?: ReadonlyArray<string> }).commands;
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
    let out = '';
    let err = '';
    child.stdout.on('data', (b: Buffer) => {
      out += b.toString('utf8');
    });
    child.stderr.on('data', (b: Buffer) => {
      err += b.toString('utf8');
    });
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error(`[broker:exec] '${command}' exceeded ${opts.timeoutMs}ms`));
        }, opts.timeoutMs)
      : null;
    const onAbort = (): void => {
      child.kill('SIGTERM');
    };
    signal.addEventListener('abort', onAbort, { once: true });
    child.on('error', (e: Error) => {
      if (timer) clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(e);
    });
    child.on('close', (exitCode) => {
      if (timer) clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve({ stdout: out, stderr: err, exitCode });
    });
  });
}
