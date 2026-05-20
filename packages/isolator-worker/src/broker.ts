import { promises as fs } from 'node:fs';
import type { CapabilitySpec } from '@moxxy/sdk';
import { pathInScope, urlInScope } from '@moxxy/plugin-security';

/**
 * Parent-side broker: serves capability-mediated RPC requests from the
 * worker. Each `broker-request` from the worker is validated against
 * the tool's declared `caps` before executing the underlying syscall.
 *
 * The set of ops here is the *boundary* of what worker-isolated tools
 * can do to the outside world. Adding a new op = explicitly extending
 * that boundary. Don't pass through `child_process`, raw net, env
 * mutation, or anything else without a deliberate decision.
 *
 * Lives in `@moxxy/isolator-worker` for now. If a future subprocess
 * isolator wants the same broker, this module gets extracted into a
 * shared `@moxxy/isolator-broker` package.
 */

export type BrokerOp = 'fs.readFile' | 'fetch';

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
 * Execute a single broker request. Pure (no postMessage); the worker
 * isolator wires the result back over the worker channel.
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
    case 'fetch':
      return brokerFetch(req.args, ctx);
    default: {
      const _exhaustive: never = req.op;
      throw new Error(`[broker] unknown op: ${String(_exhaustive)}`);
    }
  }
}

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

async function brokerFetch(
  args: ReadonlyArray<unknown>,
  { caps, signal }: BrokerContext,
): Promise<{
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}> {
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
