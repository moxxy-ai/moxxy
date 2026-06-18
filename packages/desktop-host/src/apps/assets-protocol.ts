/**
 * A hardened, local-only `moxxy-app://` scheme handler that serves an installed
 * app's downloaded assets to the renderer (and its workers).
 *
 * WHY a custom scheme: the document anonymizer's NER worker loads its model with
 * transformers.js, which fetches files over HTTP(S). We rewrite those fetches to
 * `moxxy-app://assets/anonymizer/<path>` so the model is read from the locally
 * installed bundle under `userData/moxxy-apps/` — NO network egress at use time,
 * which is the whole point of the offline anonymizer. The scheme is registered
 * privileged (standard + secure + fetch + stream) by the Electron main so the
 * renderer's CSP `connect-src moxxy-app:` allows it.
 *
 * Threat model: the renderer is untrusted (a single XSS would otherwise inherit
 * main-process authority). So this handler is deliberately strict — exactly the
 * same containment discipline as {@link ../loopback-server.ts}:
 *   - GET/HEAD only (405 otherwise);
 *   - host MUST be `assets`, the first path segment is a slug-validated appId,
 *     the remainder is the file path (reject NUL / empty);
 *   - the resolved path is confirmed (lexically AND via realpath) to stay inside
 *     the app's own dir — no `..`, no symlink escape, nothing outside
 *     `userData/moxxy-apps/<appId>/` is ever readable (404 on escape/miss).
 * It serves static bytes only; there is no dynamic surface to exploit, and it
 * opens no network path (it reads confined local files), so the offline
 * guarantee holds even while the scheme is connectable.
 */

import { createReadStream } from 'node:fs';
import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

import { protocol } from 'electron';

import { appDir } from './installer.js';

/** The scheme this module serves. Registered privileged by the Electron main. */
export const APP_ASSET_SCHEME = 'moxxy-app';

/** extension → MIME. Small + explicit (no `mime` dep). Unknown ⇒ octet-stream;
 *  `.wasm` gets the real `application/wasm` so the streaming compiler accepts
 *  it under the renderer's CSP. */
function mimeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.json':
      return 'application/json';
    case '.txt':
      return 'text/plain';
    case '.wasm':
      return 'application/wasm';
    // ORT's loader is an ESM module the worker `import()`s — module scripts are
    // MIME-checked, so it MUST be served with a JavaScript type or the import
    // is blocked.
    case '.mjs':
    case '.js':
      return 'text/javascript';
    default:
      return 'application/octet-stream';
  }
}

const APP_ID = /^[a-z][a-z0-9-]*$/;

/**
 * Resolve a `moxxy-app://` request URL to a concrete, contained absolute file
 * path under `appsRoot`, or `null` to reject (404/403). Pure (no Electron) so
 * it's unit-testable. Expected URL form: `moxxy-app://assets/<appId>/<rest...>`.
 */
export function resolveAssetRequest(appsRoot: string, requestUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return null;
  }
  // Host must be the literal `assets` bucket.
  if (parsed.hostname !== 'assets') return null;

  // Decode the path; reject NUL (a classic truncation trick) before disk.
  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;

  // Split `/<appId>/<rest...>`.
  const segments = pathname.replace(/^\/+/, '').split('/');
  const appId = segments.shift();
  const rest = segments.join('/');
  if (!appId || !APP_ID.test(appId) || rest.length === 0) return null;

  let dir: string;
  try {
    dir = appDir(appsRoot, appId);
  } catch {
    return null;
  }

  // Lexical containment is the security boundary: `path.resolve` collapses `..`
  // and absolute segments, so the only thing that lands under `dir` is a real
  // descendant.
  const abs = path.resolve(dir, '.' + (rest.startsWith('/') ? rest : '/' + rest));
  if (abs !== dir && !abs.startsWith(dir + path.sep)) return null;

  // Must be an existing regular file.
  let isFile: boolean;
  try {
    isFile = statSync(abs).isFile();
  } catch {
    return null;
  }
  if (!isFile) return null;

  // Symlink-escape insurance: canonicalise the app dir AND the file, re-check
  // containment. Belt-and-braces on top of the lexical check above.
  try {
    const realDir = realpathSync(dir);
    const real = realpathSync(abs);
    if (real !== realDir && !real.startsWith(realDir + path.sep)) return null;
  } catch {
    /* realpath unavailable — trust the lexical containment check above */
  }
  return abs;
}

/**
 * Install the `moxxy-app://` protocol handler on Electron's default `protocol`.
 * Confined to `appsRoot` (`userData/moxxy-apps`). Call once, after app ready.
 */
export function installAppAssetProtocol(appsRoot: string): void {
  protocol.handle(APP_ASSET_SCHEME, (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const abs = resolveAssetRequest(appsRoot, request.url);
    if (!abs) return new Response(null, { status: 404 });

    let size: number;
    try {
      size = statSync(abs).size;
    } catch {
      return new Response(null, { status: 404 });
    }
    const headers = {
      'content-type': mimeFor(abs),
      'content-length': String(size),
    };
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
    return new Response(Readable.toWeb(createReadStream(abs)) as ReadableStream, {
      status: 200,
      headers,
    });
  });
}
