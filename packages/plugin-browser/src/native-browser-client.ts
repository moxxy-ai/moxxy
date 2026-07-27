import { randomUUID } from 'node:crypto';
import { connect } from 'node:net';

import { MoxxyError, z } from '@moxxy/sdk';

import {
  NATIVE_BROWSER_PROTOCOL_VERSION,
  type BrowserSessionAction,
} from './browser-action.js';
import {
  BROWSER_ERROR_CODES,
  formatBrowserErrorForModel,
  type BrowserErrorDetails,
} from './browser-errors.js';

const DEFAULT_TIMEOUT_MS = 150_000;
const MAX_RESPONSE_BYTES = 96 * 1024 * 1024;

const responseSchema = z
  .object({
    id: z.string().min(1).max(128),
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z
      .object({
        code: z.enum(BROWSER_ERROR_CODES),
        message: z.string().min(1).max(16_384),
        nextAction: z.enum(['observe', 'stop', 'ask_user', 'retry_once', 'restart']),
        retryable: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict();

export interface NativeBrowserBridgeClient {
  call(action: BrowserSessionAction, signal?: AbortSignal): Promise<unknown>;
}

export interface NativeBrowserClientEnvironment {
  readonly MOXXY_BROWSER_BACKEND?: string;
  readonly MOXXY_NATIVE_BROWSER_SOCKET?: string;
  readonly MOXXY_NATIVE_BROWSER_TOKEN?: string;
  readonly MOXXY_NATIVE_BROWSER_WORKSPACE_ID?: string;
  readonly MOXXY_NATIVE_BROWSER_PROTOCOL_VERSION?: string;
}

/** Resolves the browser backend once while the plugin is constructed. A
 * missing native setting means the ordinary CLI/Playwright path; a partially
 * configured native setting is a hard error rather than a silent split-brain
 * fallback onto a second page. */
export function createNativeBrowserBridgeClient(
  environment: NativeBrowserClientEnvironment = process.env,
): NativeBrowserBridgeClient | null {
  if (environment.MOXXY_BROWSER_BACKEND?.trim().toLowerCase() !== 'native') return null;
  const socketPath = requiredEnvironment(environment.MOXXY_NATIVE_BROWSER_SOCKET, 'socket');
  const token = requiredEnvironment(environment.MOXXY_NATIVE_BROWSER_TOKEN, 'token');
  const workspaceId = requiredEnvironment(
    environment.MOXXY_NATIVE_BROWSER_WORKSPACE_ID,
    'workspace id',
  );
  const protocolVersion = Number(
    requiredEnvironment(environment.MOXXY_NATIVE_BROWSER_PROTOCOL_VERSION, 'protocol version'),
  );
  if (protocolVersion !== NATIVE_BROWSER_PROTOCOL_VERSION) {
    throw new MoxxyError({
      code: 'INTERNAL',
      message: `[BACKEND_MISMATCH] Native browser plugin protocol ${String(protocolVersion)} does not match required protocol ${NATIVE_BROWSER_PROTOCOL_VERSION}. Restart or update the browser plugin.`,
    });
  }
  return new SocketNativeBrowserBridgeClient({ socketPath, token, workspaceId, protocolVersion });
}

interface SocketNativeBrowserBridgeClientOptions {
  readonly socketPath: string;
  readonly token: string;
  readonly workspaceId: string;
  readonly protocolVersion: number;
  readonly timeoutMs?: number;
}

class SocketNativeBrowserBridgeClient implements NativeBrowserBridgeClient {
  constructor(private readonly options: SocketNativeBrowserBridgeClientOptions) {}

  call(action: BrowserSessionAction, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) return Promise.reject(abortedError());
    const id = randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const socket = connect(this.options.socketPath);
      let buffer = '';
      let settled = false;
      const finish = (result: { ok: true; value: unknown } | { ok: false; error: Error }): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        socket.destroy();
        if (result.ok) resolve(result.value);
        else reject(result.error);
      };
      const onAbort = (): void => finish({ ok: false, error: abortedError() });
      const timer = setTimeout(() => {
        finish({
          ok: false,
          error: new MoxxyError({
            code: 'INTERNAL',
            message: `native browser bridge timed out after ${this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`,
          }),
        });
      }, this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      timer.unref?.();
      signal?.addEventListener('abort', onAbort, { once: true });
      socket.setEncoding('utf8');
      socket.once('error', (error) => finish({ ok: false, error }));
      socket.once('connect', () => {
        const request = {
          id,
          token: this.options.token,
          workspaceId: this.options.workspaceId,
          protocolVersion: this.options.protocolVersion,
          action,
        };
        socket.write(`${JSON.stringify(request)}\n`);
      });
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        if (Buffer.byteLength(buffer, 'utf8') > MAX_RESPONSE_BYTES) {
          finish({
            ok: false,
            error: new MoxxyError({
              code: 'INTERNAL',
              message: 'native browser bridge response exceeded the safe size limit',
            }),
          });
          return;
        }
        const newline = buffer.indexOf('\n');
        if (newline < 0) return;
        let raw: unknown;
        try {
          raw = JSON.parse(buffer.slice(0, newline));
        } catch {
          finish({ ok: false, error: protocolError('returned malformed JSON') });
          return;
        }
        const parsed = responseSchema.safeParse(raw);
        if (!parsed.success || parsed.data.id !== id) {
          finish({ ok: false, error: protocolError('returned an invalid response') });
          return;
        }
        if (!parsed.data.ok) {
          const details = parsed.data.error;
          finish({
            ok: false,
            error: new MoxxyError({
              code: 'INTERNAL',
              message: details
                ? formatBrowserErrorForModel(details as BrowserErrorDetails)
                : 'native browser operation failed',
            }),
          });
          return;
        }
        finish({ ok: true, value: parsed.data.result });
      });
    });
  }
}

function requiredEnvironment(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (normalized) return normalized;
  throw new MoxxyError({
    code: 'INTERNAL',
    message: `native browser backend is missing its ${label}; restart the desktop app`,
  });
}

function abortedError(): MoxxyError {
  return new MoxxyError({ code: 'NETWORK_ABORTED', message: 'browser_session aborted' });
}

function protocolError(detail: string): MoxxyError {
  return new MoxxyError({ code: 'INTERNAL', message: `native browser bridge ${detail}` });
}
