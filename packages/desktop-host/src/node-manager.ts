/**
 * Auto-install a private Node.js for non-technical users.
 *
 * `moxxy` is a Node CLI, so a machine without Node can't run it. Rather than
 * sending users off to nodejs.org and hoping they pick the right installer,
 * the onboarding Node step can download the official Node LTS for the user's
 * OS/arch straight into the app's writable data dir and put it on PATH — no
 * admin rights, no package manager.
 *
 * Integration is deliberately tiny: {@link activateManagedNode} prepends the
 * managed `bin` dir to `process.env.PATH`. Everything that resolves `node` /
 * `npm` already reads `process.env.PATH` (cli-resolver's `findExecutable` and
 * `spawnPath`), so the probe, the `npm install -g @moxxy/cli` step, and the
 * runner supervisor all pick it up with no other changes.
 *
 * Progress streams to the renderer over the same `onboarding.install.progress`
 * channel the npm install uses, so the Node step can reuse the CLI step's log
 * box verbatim.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { get as httpsGet } from 'node:https';
import path, { delimiter } from 'node:path';
import type { BrowserWindow } from 'electron';
import { sendEvent } from './send-event';
import { wsEventBus } from './event-bus';

/**
 * Pinned Node LTS. Bump deliberately (and update node-manager.test.ts) rather
 * than tracking "latest" — we download + execute this, so the version is part
 * of the app's supply chain.
 */
export const MANAGED_NODE_VERSION = 'v22.12.0';

const DIST_BASE = 'https://nodejs.org/dist';

/** Idle/connect timeout for a download or SHASUMS fetch. A stalled
 *  nodejs.org connection (TCP black-hole, half-open after a network drop)
 *  must surface an error rather than hang the onboarding step forever. */
const HTTP_TIMEOUT_MS = 30_000;

/** Hosts we will follow a redirect to. The archive AND its SHASUMS both flow
 *  through {@link httpStream}; if a redirect could point anywhere, an on-path
 *  attacker could swing BOTH to a host serving a matching (archive, checksum)
 *  pair and defeat the integrity check — TLS-to-nodejs.org is the only trust
 *  anchor and an unpinned redirect erases it. Keep this list tight. */
const ALLOWED_DOWNLOAD_HOSTS: ReadonlySet<string> = new Set(['nodejs.org']);

/** True only for nodejs.org (and its subdomains). Exported for the integrity
 *  test — a redirect off this host would defeat the SHASUMS check. */
export function isAllowedDownloadHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return ALLOWED_DOWNLOAD_HOSTS.has(h) || [...ALLOWED_DOWNLOAD_HOSTS].some((a) => h.endsWith(`.${a}`));
}

export interface ManagedNodeArchive {
  /** The archive's top-level directory, also the extracted folder name. */
  readonly dirName: string;
  /** Archive filename, e.g. `node-v22.12.0-darwin-arm64.tar.gz`. */
  readonly fileName: string;
  /** Full download URL on nodejs.org. */
  readonly url: string;
  /** SHASUMS256.txt URL for the same release. */
  readonly shasumsUrl: string;
}

/**
 * Map the current platform/arch onto the official Node archive. Pure +
 * deterministic so the wiring is unit-testable without a network. Throws a
 * user-readable error for arch/OS combos Node doesn't publish a binary for —
 * the caller surfaces it and the manual nodejs.org link remains the fallback.
 */
export function nodeArchive(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  version: string = MANAGED_NODE_VERSION,
): ManagedNodeArchive {
  const osTok = platform === 'darwin' ? 'darwin' : platform === 'win32' ? 'win' : platform === 'linux' ? 'linux' : null;
  if (!osTok) {
    throw new Error(`Automatic Node install isn't supported on "${platform}" — install it from nodejs.org.`);
  }
  if (arch !== 'arm64' && arch !== 'x64') {
    throw new Error(`Automatic Node install isn't supported on "${arch}" CPUs — install it from nodejs.org.`);
  }
  const ext = osTok === 'win' ? 'zip' : osTok === 'linux' ? 'tar.xz' : 'tar.gz';
  const dirName = `node-${version}-${osTok}-${arch}`;
  const fileName = `${dirName}.${ext}`;
  return {
    dirName,
    fileName,
    url: `${DIST_BASE}/${version}/${fileName}`,
    shasumsUrl: `${DIST_BASE}/${version}/SHASUMS256.txt`,
  };
}

/** Where managed Node installs live (one folder per `node-vX-os-arch`). */
export function managedNodeRoot(userDataDir: string): string {
  return path.join(userDataDir, 'node');
}

/**
 * The `bin` dir of an installed managed Node, or null if none is present.
 * Scans for any `node-v*` folder containing the node binary so a version bump
 * still finds the previously-installed one until it's replaced.
 */
export function managedNodeBinDir(
  userDataDir: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const root = managedNodeRoot(userDataDir);
  if (!existsSync(root)) return null;
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return null;
  }
  const nodeExe = platform === 'win32' ? 'node.exe' : path.join('bin', 'node');
  // Prefer the pinned version's folder, then any other node-v* folder.
  // Partition rather than sort: the "pinned-first" comparator returns 0 for
  // any pair where neither (or both) is pinned, which is NOT a strict weak
  // ordering, so engine sort stability for the goal isn't guaranteed. A
  // partition expresses "pinned folders first, original order otherwise"
  // unambiguously.
  const pinned = `node-${MANAGED_NODE_VERSION}-`;
  const all = entries.filter((e) => e.startsWith('node-v'));
  const candidates = [
    ...all.filter((e) => e.startsWith(pinned)),
    ...all.filter((e) => !e.startsWith(pinned)),
  ];
  for (const entry of candidates) {
    const dir = path.join(root, entry);
    if (existsSync(path.join(dir, nodeExe))) {
      return platform === 'win32' ? dir : path.join(dir, 'bin');
    }
  }
  return null;
}

/**
 * Prepend a managed Node's bin dir to `process.env.PATH` if one is installed.
 * Idempotent (won't stack duplicates). Returns the bin dir it activated, or
 * null if there's no managed Node. Call at startup so a Node installed on a
 * previous run persists, and right after a fresh install.
 */
export function activateManagedNode(userDataDir: string): string | null {
  const binDir = managedNodeBinDir(userDataDir);
  if (!binDir) return null;
  const current = process.env.PATH ?? '';
  const parts = current.split(delimiter);
  if (parts[0] !== binDir) {
    process.env.PATH = [binDir, ...parts.filter((p) => p !== binDir)].join(delimiter);
  }
  return binDir;
}

/**
 * Download + extract the official Node LTS for this machine into the app data
 * dir, verify its sha256 against the release's SHASUMS256.txt, and put it on
 * PATH. Streams human-readable progress to the renderer. Resolves with the
 * installed version (from `node --version`); rejects with a readable message
 * on any failure (the UI keeps the manual nodejs.org fallback).
 */
export async function installManagedNode(
  userDataDir: string,
  window: BrowserWindow,
): Promise<{ ok: boolean; version: string | null }> {
  const archive = nodeArchive();
  const root = managedNodeRoot(userDataDir);
  const downloadDir = path.join(root, '.download');
  const archivePath = path.join(downloadDir, archive.fileName);
  mkdirSync(downloadDir, { recursive: true });

  emit(window, `Installing Node ${MANAGED_NODE_VERSION} for ${process.platform}/${process.arch}…`);

  try {
    emit(window, `Downloading ${archive.fileName}…`);
    await download(archive.url, archivePath, (pct) => {
      if (pct !== null) emit(window, `Downloading Node… ${pct}%`);
    });

    emit(window, 'Verifying download…');
    await verifyChecksum(archive.shasumsUrl, archivePath, archive.fileName);

    emit(window, 'Extracting…');
    await extract(archivePath, root);

    rmSync(downloadDir, { recursive: true, force: true });

    const binDir = activateManagedNode(userDataDir);
    if (!binDir) throw new Error('Extracted Node but could not locate its bin directory.');

    const version = await probeManagedNodeVersion(binDir);
    emit(window, `Node ready: ${version ?? MANAGED_NODE_VERSION}`);
    return { ok: true, version };
  } catch (e) {
    // Clean up a partial download so a retry starts fresh.
    rmSync(downloadDir, { recursive: true, force: true });
    const msg = e instanceof Error ? e.message : String(e);
    emit(window, `Install failed: ${msg}`);
    throw e instanceof Error ? e : new Error(msg);
  }
}

// ---- internals -----------------------------------------------------------

function emit(window: BrowserWindow, line: string): void {
  sendEvent(window, 'onboarding.install.progress', line);
  // Mirror to non-Electron transports. No-op without a WS bridge attached.
  wsEventBus.broadcast('onboarding.install.progress', line);
}

/** GET a URL following redirects, invoking `onData`/`onEnd` on the body.
 *  Redirects are pinned to {@link ALLOWED_DOWNLOAD_HOSTS} and every request
 *  carries an idle timeout so a black-holed connection can't hang forever. */
function httpStream(
  url: string,
  onResponse: (res: import('node:http').IncomingMessage) => void,
  onError: (err: Error) => void,
  redirectsLeft = 5,
): void {
  // Reject an off-host URL before we even open the socket (covers the initial
  // call and every redirect target).
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    onError(new Error(`Invalid download URL: ${url}`));
    return;
  }
  if (!isAllowedDownloadHost(hostname)) {
    onError(new Error(`Refusing to download from untrusted host "${hostname}".`));
    return;
  }
  const req = httpsGet(url, (res) => {
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      if (redirectsLeft <= 0) {
        onError(new Error('Too many redirects'));
        res.resume();
        return;
      }
      let next: string;
      try {
        next = new URL(res.headers.location, url).toString();
      } catch {
        onError(new Error(`Invalid redirect location for ${url}`));
        res.resume();
        return;
      }
      res.resume();
      httpStream(next, onResponse, onError, redirectsLeft - 1);
      return;
    }
    if (status !== 200) {
      onError(new Error(`Download failed (HTTP ${status}) for ${url}`));
      res.resume();
      return;
    }
    onResponse(res);
  });
  req.on('error', onError);
  req.setTimeout(HTTP_TIMEOUT_MS, () => {
    req.destroy(new Error(`Download timed out after ${HTTP_TIMEOUT_MS} ms for ${url}`));
  });
}

/** Download `url` to `dest`, reporting integer percent (or null if the server
 *  didn't send a content-length). */
function download(
  url: string,
  dest: string,
  onProgress: (pct: number | null) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    httpStream(
      url,
      (res) => {
        const total = Number(res.headers['content-length'] ?? 0);
        let received = 0;
        let lastPct = -1;
        const file = createWriteStream(dest);
        // A source error after `res.pipe(file)` does NOT auto-close the write
        // stream — destroy it so we don't leak the fd / leave a half-written
        // file locked. `fail` is idempotent.
        let settled = false;
        const fail = (err: Error): void => {
          if (settled) return;
          settled = true;
          file.destroy();
          reject(err);
        };
        res.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (total > 0) {
            const pct = Math.floor((received / total) * 100);
            if (pct !== lastPct && pct % 5 === 0) {
              lastPct = pct;
              onProgress(pct);
            }
          }
        });
        res.pipe(file);
        file.on('finish', () =>
          file.close((err) => {
            if (settled) return;
            settled = true;
            if (err) reject(err);
            else resolve();
          }),
        );
        file.on('error', fail);
        res.on('error', fail);
      },
      reject,
    );
  });
}

/** Fetch a (small) text resource following redirects. */
function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    httpStream(
      url,
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (body += c));
        res.on('end', () => resolve(body));
        res.on('error', reject);
      },
      reject,
    );
  });
}

/** sha256 of a file, hex. */
function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(file);
    stream.on('data', (c) => hash.update(c));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/** Verify `archivePath` against the `fileName` line in SHASUMS256.txt. We are
 *  about to extract + execute this, so a mismatch is fatal. */
async function verifyChecksum(
  shasumsUrl: string,
  archivePath: string,
  fileName: string,
): Promise<void> {
  const shasums = await fetchText(shasumsUrl);
  // Lines look like: "<sha256>  node-v22.12.0-darwin-arm64.tar.gz"
  const line = shasums.split(/\r?\n/).find((l) => l.trim().endsWith(` ${fileName}`) || l.trim().endsWith(`  ${fileName}`));
  const expected = line?.trim().split(/\s+/)[0]?.toLowerCase();
  if (!expected) throw new Error(`No checksum found for ${fileName}.`);
  const actual = (await sha256File(archivePath)).toLowerCase();
  if (actual !== expected) {
    throw new Error('Checksum mismatch — the download may be corrupt. Please retry.');
  }
}

/**
 * Escape a string for a PowerShell SINGLE-quoted literal by doubling every
 * apostrophe — the only metacharacter inside `'...'`. Without this, a path
 * containing `'` (e.g. a Windows account name like O'Brien, or any future
 * caller-supplied component) terminates the quote and lets the remainder parse
 * as PowerShell, running in the app's security context during onboarding.
 */
export function psSingleQuote(s: string): string {
  return s.replace(/'/g, "''");
}

/** Extract a Node archive into `root`. tar handles both .tar.gz (macOS) and
 *  .tar.xz (Linux) with auto-detection; Windows uses PowerShell Expand-Archive
 *  for the .zip. */
function extract(archivePath: string, root: string): Promise<void> {
  if (archivePath.endsWith('.zip')) {
    return run('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${psSingleQuote(archivePath)}' ` +
        `-DestinationPath '${psSingleQuote(root)}' -Force`,
    ]);
  }
  // `-xf` (no explicit -z/-J) lets bsdtar (macOS) and GNU tar (Linux) detect
  // gzip/xz themselves, avoiding the -J portability gap between the two tars.
  return run('tar', ['-xf', archivePath, '-C', root]);
}

/** node --version from a managed bin dir; null if it can't be run. */
function probeManagedNodeVersion(binDir: string): Promise<string | null> {
  const nodeBin = path.join(binDir, process.platform === 'win32' ? 'node.exe' : 'node');
  return new Promise((resolve) => {
    const proc = spawn(nodeBin, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    proc.stdout?.on('data', (b: Buffer) => (out += b.toString()));
    proc.on('error', () => resolve(null));
    proc.on('exit', (code) => resolve(code === 0 ? out.trim() : null));
  });
}

/** Spawn a command, resolve on exit 0, reject otherwise (with stderr tail). */
function run(command: string, args: ReadonlyArray<string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, [...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr?.on('data', (b: Buffer) => (err += b.toString()));
    proc.on('error', (e) => reject(new Error(`${command} not available: ${e.message}`)));
    proc.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} exited ${code}${err ? `: ${err.trim().slice(-300)}` : ''}`)),
    );
  });
}
