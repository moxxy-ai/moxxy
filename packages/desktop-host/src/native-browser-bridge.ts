import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, lstat, mkdir, unlink } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import path from 'node:path';

import { isNamedPipe, platformSocket } from '@moxxy/runner';
import { z } from '@moxxy/sdk';

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_DARWIN_SOCKET_BYTES = 103;
const MAX_LINUX_SOCKET_BYTES = 107;
const SAFE_ID = /^[A-Za-z0-9_.-]+$/;

const requiredTabId = z.string().min(1).max(256);
const optionalTabId = requiredTabId.optional();
const publicHttpUrl = z
  .string()
  .url()
  .refine((url) => /^https?:\/\//i.test(url), 'only http(s) URLs allowed');

const actionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('goto'),
    url: publicHttpUrl,
    waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
    timeoutMs: z.number().int().positive().max(120_000).optional(),
    tabId: optionalTabId,
  }).strict(),
  z.object({
    kind: z.literal('click'),
    selector: z.string().min(1).max(16_384),
    timeoutMs: z.number().int().positive().max(60_000).optional(),
    tabId: optionalTabId,
  }).strict(),
  z.object({
    kind: z.literal('fill'),
    selector: z.string().min(1).max(16_384),
    value: z.string().max(2 * 1024 * 1024),
    timeoutMs: z.number().int().positive().max(60_000).optional(),
    tabId: optionalTabId,
  }).strict(),
  z.object({ kind: z.literal('text'), selector: z.string().max(16_384).optional(), tabId: optionalTabId }).strict(),
  z.object({ kind: z.literal('html'), tabId: optionalTabId }).strict(),
  z.object({ kind: z.literal('screenshot'), fullPage: z.boolean().optional(), tabId: optionalTabId }).strict(),
  z.object({ kind: z.literal('eval'), expression: z.string().min(1).max(2 * 1024 * 1024), tabId: optionalTabId }).strict(),
  z.object({ kind: z.literal('url'), tabId: optionalTabId }).strict(),
  z.object({ kind: z.literal('tabs') }).strict(),
  z.object({ kind: z.literal('new_tab'), url: publicHttpUrl.optional() }).strict(),
  z.object({ kind: z.literal('select_tab'), tabId: requiredTabId }).strict(),
  z.object({ kind: z.literal('close_tab'), tabId: requiredTabId }).strict(),
]);

const requestSchema = z
  .object({
    id: z.string().min(1).max(128),
    token: z.string().regex(/^[a-f0-9]{64}$/),
    workspaceId: z.string().min(1).max(256).regex(SAFE_ID),
    action: actionSchema,
  })
  .strict();

export type NativeBrowserAgentAction = z.infer<typeof actionSchema>;

export interface NativeBrowserRunnerEnvironment {
  readonly MOXXY_BROWSER_BACKEND: 'native';
  readonly MOXXY_NATIVE_BROWSER_SOCKET: string;
  readonly MOXXY_NATIVE_BROWSER_TOKEN: string;
  readonly MOXXY_NATIVE_BROWSER_WORKSPACE_ID: string;
}

export interface NativeBrowserBridgeOptions {
  readonly socketPath: string;
  readonly execute: (workspaceId: string, action: NativeBrowserAgentAction) => Promise<unknown>;
}

/** Local-only, workspace-authenticated RPC boundary between a spawned runner
 * and Electron's NativeBrowserController. It deliberately exposes actions,
 * never Electron/CDP commands. */
export class NativeBrowserBridge {
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();
  private readonly tokens = new Map<string, string>();

  constructor(private readonly options: NativeBrowserBridgeOptions) {}

  async start(): Promise<void> {
    if (this.server) return;
    await this.prepareSocket();
    const server = createServer((socket) => this.handleSocket(socket));
    this.server = server;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(this.options.socketPath, () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      if (!isNamedPipe(this.options.socketPath)) await chmod(this.options.socketPath, 0o600);
    } catch (error) {
      this.server = null;
      server.close();
      throw error;
    }
  }

  runnerEnvironment(workspaceId: string): NativeBrowserRunnerEnvironment {
    if (!this.server) throw new Error('native browser bridge has not started');
    if (!SAFE_ID.test(workspaceId) || workspaceId === '.' || workspaceId === '..') {
      throw new Error(`unsafe native browser workspace id: ${JSON.stringify(workspaceId)}`);
    }
    let token = this.tokens.get(workspaceId);
    if (!token) {
      token = randomBytes(32).toString('hex');
      this.tokens.set(workspaceId, token);
    }
    return {
      MOXXY_BROWSER_BACKEND: 'native',
      MOXXY_NATIVE_BROWSER_SOCKET: this.options.socketPath,
      MOXXY_NATIVE_BROWSER_TOKEN: token,
      MOXXY_NATIVE_BROWSER_WORKSPACE_ID: workspaceId,
    };
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.tokens.clear();
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (!isNamedPipe(this.options.socketPath)) {
      await unlink(this.options.socketPath).catch(() => undefined);
    }
  }

  private async prepareSocket(): Promise<void> {
    if (isNamedPipe(this.options.socketPath)) return;
    const directory = path.dirname(this.options.socketPath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const directoryStats = await lstat(directory);
    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
      throw new Error('native browser socket directory must be a real directory');
    }
    const currentUserId = typeof process.getuid === 'function' ? process.getuid() : null;
    if (currentUserId !== null && directoryStats.uid !== currentUserId) {
      throw new Error('native browser socket directory must belong to the current user');
    }
    await chmod(directory, 0o700);
    await unlink(this.options.socketPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  private handleSocket(socket: Socket): void {
    this.sockets.add(socket);
    socket.setEncoding('utf8');
    let buffer = '';
    let handled = false;
    const close = (): void => {
      this.sockets.delete(socket);
    };
    socket.once('close', close);
    socket.once('error', close);
    socket.on('data', (chunk: string) => {
      if (handled) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer, 'utf8') > MAX_REQUEST_BYTES) {
        handled = true;
        this.writeError(socket, requestId(buffer), 'native browser request exceeded the safe size limit');
        return;
      }
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      handled = true;
      void this.dispatch(socket, buffer.slice(0, newline));
    });
  }

  private async dispatch(socket: Socket, line: string): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      this.writeError(socket, 'invalid-request', 'invalid native browser request');
      return;
    }
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) {
      this.writeError(socket, requestId(raw), 'invalid native browser request');
      return;
    }
    const request = parsed.data;
    const expected = this.tokens.get(request.workspaceId);
    if (!expected || !tokensEqual(expected, request.token)) {
      this.writeError(socket, request.id, 'native browser authorization failed');
      return;
    }
    try {
      const result = await this.options.execute(request.workspaceId, request.action);
      socket.end(`${JSON.stringify({ id: request.id, ok: true, result })}\n`);
    } catch (error) {
      this.writeError(socket, request.id, errorMessage(error));
    }
  }

  private writeError(socket: Socket, id: string, message: string): void {
    socket.end(`${JSON.stringify({ id, ok: false, error: { message } })}\n`);
  }
}

export function nativeBrowserBridgeSocket(
  userDataDir: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const candidate = platformSocket(
    'native-browser',
    path.join(userDataDir, 'native-browser', 'bridge.sock'),
    platform,
  );
  if (platform === 'win32') return candidate;
  const maxBytes = platform === 'darwin' ? MAX_DARWIN_SOCKET_BYTES : MAX_LINUX_SOCKET_BYTES;
  if (Buffer.byteLength(candidate, 'utf8') <= maxBytes) return candidate;

  const profileHash = createHash('sha256')
    .update(path.resolve(userDataDir))
    .digest('hex')
    .slice(0, 24);
  return path.posix.join('/tmp', `moxxy-native-browser-${profileHash}`, 'bridge.sock');
}

function tokensEqual(expected: string, received: string): boolean {
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(received, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function requestId(value: unknown): string {
  if (!value || typeof value !== 'object') return 'invalid-request';
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 && id.length <= 128 ? id : 'invalid-request';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 16_384) : String(error).slice(0, 16_384);
}
