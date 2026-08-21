import { createServer, type Server, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserHost } from './host';

/**
 * The channel the agent's tools reach the desktop browser through.
 *
 * The tools run in the runner — a separate process — while the page lives in
 * this one. Without this bridge the agent would have to drive its own browser,
 * and then the human's pane and the agent's page would be two different
 * documents: watching the agent work would show you nothing, and taking over
 * would take over the wrong thing.
 *
 * Deliberately NOT part of the runner protocol. Adding methods there would
 * mean a protocol version bump and would mix page traffic in with the
 * conversation stream. A private socket keeps the blast radius at this file,
 * and its absence is how the plugin knows to fall back to its own browser.
 *
 * It speaks exactly the sidecar's wire format — newline-delimited
 * `{id, method, params}` → `{id, ok, result|error}` — so the plugin's tools
 * cannot tell the two backends apart.
 */

/** Bytes past which an inbound line is malformed rather than large. */
const MAX_LINE = 1_000_000;

export interface BridgeAddress {
  readonly socketPath: string;
  readonly token: string;
}

export class BrowserBridge {
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();
  private address: BridgeAddress | null = null;
  /** The 0700 directory holding the socket, removed with it. */
  private dir: string | null = null;

  constructor(private readonly host: BrowserHost) {}

  /**
   * Listen on a private socket. The path is unguessable and the directory is
   * owner-only, so the token is a second lock rather than the only one — a
   * process running as another user cannot reach the socket to try it.
   */
  async start(): Promise<BridgeAddress> {
    if (this.address) return this.address;
    sweepAbandonedBridges();
    const dir = join(tmpdir(), `moxxy-browser-${process.pid}`);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.dir = dir;
    const socketPath = join(dir, `${randomBytes(8).toString('hex')}.sock`);
    const token = randomBytes(32).toString('hex');

    const server = createServer((socket) => this.accept(socket, token));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    try {
      chmodSync(socketPath, 0o600);
    } catch {
      // The 0700 directory is the real boundary; a filesystem that refuses the
      // chmod does not widen access beyond it.
    }

    this.server = server;
    this.address = { socketPath, token };
    return this.address;
  }

  private accept(socket: Socket, token: string): void {
    this.sockets.add(socket);
    socket.setEncoding('utf8');
    let buf = '';
    let authed = false;

    const reply = (payload: unknown): void => {
      if (!socket.destroyed) socket.write(JSON.stringify(payload) + '\n');
    };

    socket.on('data', (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let req: { id?: string; method?: string; params?: Record<string, unknown> };
        try {
          req = JSON.parse(line) as typeof req;
        } catch {
          reply({ id: 'unknown', ok: false, error: { message: 'invalid JSON' } });
          continue;
        }
        const id = typeof req.id === 'string' ? req.id : 'unknown';
        if (!authed) {
          // First frame must be the handshake. Anything else is a client that
          // found the socket without being told about it.
          if (req.method !== 'hello' || req.params?.token !== token) {
            reply({ id, ok: false, error: { message: 'unauthorized' } });
            socket.destroy();
            return;
          }
          authed = true;
          reply({ id, ok: true, result: { ready: true } });
          continue;
        }
        void this.dispatch(req.method ?? '', req.params ?? {}).then(
          (result) => reply({ id, ...result }),
          (err: unknown) => reply({ id, ok: false, error: { message: err instanceof Error ? err.message : String(err) } }),
        );
      }
      if (buf.length > MAX_LINE) {
        socket.destroy();
      }
    });

    socket.on('error', () => socket.destroy());
    socket.on('close', () => this.sockets.delete(socket));
  }

  /**
   * Map the sidecar's method names onto the host. Same names, same shapes —
   * that is what lets one set of tools serve either backend.
   */
  private async dispatch(
    method: string,
    params: Record<string, unknown>,
  ): Promise<{ ok: boolean; result?: unknown; error?: { message: string } }> {
    // An empty string is a model filling in a field it has nothing for, not a
    // tab named "". Treat it as absent.
    const named = typeof params.tab_id === 'string' && params.tab_id ? params.tab_id : undefined;
    // Naming a tab is how the agent moves its own aim. Nothing the person does
    // in the pane touches it — see BrowserHost.agentTarget.
    if (named) this.host.noteAgentTab(named);
    const tabId = named ?? this.host.agentTarget();
    const sel = typeof params.selector === 'string' ? params.selector : '';
    const timeoutMs = typeof params.timeoutMs === 'number' ? params.timeoutMs : undefined;
    switch (method) {
      case 'snapshot':
        return this.host.snapshot(tabId);
      case 'act':
        return this.host.act({
          action: String(params.action ?? ''),
          uid: String(params.uid ?? ''),
          ...(typeof params.text === 'string' ? { text: params.text } : {}),
          ...(tabId ? { tab_id: tabId } : {}),
        });
      case 'goto': {
        const url = params.url;
        if (typeof url !== 'string') return { ok: false, error: { message: 'url is required' } };
        return this.host.goto(url, tabId);
      }
      case 'tabs': {
        const action = String(params.action ?? 'list');
        try {
          if (action === 'new') {
            const url = typeof params.url === 'string' && params.url ? params.url : 'about:blank';
            const newId = await this.host.newTab(url);
            // A tab the agent asked for is the tab the agent is now working in.
            this.host.noteAgentTab(newId);
            return { ok: true, result: { tabId: newId, tabs: this.host.list(), activeTabId: this.host.activeId } };
          }
          if (action === 'select') {
            if (!named) return { ok: false, error: { message: 'tab_id is required for select' } };
            this.host.select(named);
          }
          if (action === 'close') {
            if (!named) return { ok: false, error: { message: 'tab_id is required for close' } };
            this.host.unregister(named);
          }
          return { ok: true, result: { tabs: this.host.list(), activeTabId: this.host.activeId } };
        } catch (err) {
          return { ok: false, error: { message: err instanceof Error ? err.message : String(err) } };
        }
      }
      case 'capture':
        return this.host.capture({
          ...(tabId ? { tabId } : {}),
          ...(params.clip ? { clip: params.clip as { x: number; y: number; width: number; height: number } } : {}),
          ...(params.format === 'jpeg' ? { format: 'jpeg' as const } : {}),
        });
      case 'back':
      case 'forward':
      case 'reload':
        return this.host.history(method, tabId);
      case 'await_human':
        return this.host.awaitHuman({
          ...(tabId ? { tabId } : {}),
          reason: String(params.reason ?? 'The page needs you to do something the agent must not do itself.'),
        });
      case 'box':
        return this.host.boxOf(String(params.uid ?? ''), tabId);

      // Below the accessibility layer: what `browser_session` asks for. Same
      // method names and shapes as the sidecar, so the tool cannot tell the two
      // backends apart — which is the whole point of this bridge.
      case 'click':
        return this.host.clickSelector(sel, { ...(tabId ? { tabId } : {}), ...(timeoutMs ? { timeoutMs } : {}) });
      case 'fill':
        return this.host.fillSelector(sel, String(params.value ?? ''), {
          ...(tabId ? { tabId } : {}),
          ...(timeoutMs ? { timeoutMs } : {}),
        });
      case 'key':
        return this.host.key(String(params.key ?? ''), tabId);
      case 'text':
        return this.host.textOf(sel || undefined, tabId);
      case 'html':
        return this.host.htmlOf(tabId);
      case 'eval':
        return this.host.evaluate(String(params.expression ?? ''), tabId);
      case 'screenshot':
        return this.host.capture({
          ...(tabId ? { tabId } : {}),
          ...(params.fullPage === true ? { fullPage: true } : {}),
        });
      case 'close':
        // The sidecar's `close` tears its whole browser down. Here the browser
        // is the user's, on screen, holding their logins — the tool disposing of
        // its session must not take it with it.
        return { ok: true };
      case 'url': {
        const tabs = this.host.list();
        const current = tabs.find((t) => (tabId ? t.tabId === tabId : t.active));
        return current
          ? { ok: true, result: current.url }
          : { ok: false, error: { message: 'no open tab' } };
      }
      default:
        return { ok: false, error: { message: `unknown method: ${method}` } };
    }
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    const server = this.server;
    this.server = null;
    const addr = this.address;
    this.address = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    const dir = this.dir;
    this.dir = null;
    if (addr) {
      try {
        rmSync(addr.socketPath, { force: true });
      } catch {
        // Best effort; the OS reaps the temp tree eventually.
      }
    }
    if (dir) {
      try {
        // Take the directory too — a hard kill leaves it behind otherwise, and
        // an empty one per run accumulates for the life of the machine.
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best effort, as above.
      }
    }
  }
}

/** Prefix every bridge directory carries, followed by the owning pid. */
const DIR_PREFIX = 'moxxy-browser-';

/**
 * Remove bridge directories whose process is gone.
 *
 * A clean quit takes its own directory with it, but a crash or a `kill -9`
 * cannot — and one empty directory per crash accumulates for the life of the
 * machine. The pid is in the name, so liveness is a `kill(pid, 0)` probe: ESRCH
 * means the owner is gone and the directory is litter. EPERM means it is alive
 * under another user, which is emphatically not ours to delete.
 *
 * Exported for testing; `start` calls it.
 */
export function sweepAbandonedBridges(root: string = tmpdir()): number {
  let removed = 0;
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return 0;
  }
  for (const name of entries) {
    if (!name.startsWith(DIR_PREFIX)) continue;
    const pid = Number(name.slice(DIR_PREFIX.length));
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (pid === process.pid) continue;
    try {
      process.kill(pid, 0);
      continue; // alive — leave it alone
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ESRCH') continue;
    }
    try {
      rmSync(join(root, name), { recursive: true, force: true });
      removed += 1;
    } catch {
      // Not ours to remove, or already gone.
    }
  }
  return removed;
}
