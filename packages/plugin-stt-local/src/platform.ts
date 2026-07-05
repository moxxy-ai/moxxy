/**
 * Resolve the sherpa-onnx platform binary package and the environment the
 * sidecar must be spawned with.
 *
 * CRITICAL native gotcha (scout-verified): sherpa-onnx-node's addon dlopen's
 * sibling shared libs (`libonnxruntime.dylib`, `libsherpa-onnx-c-api.dylib`, …)
 * that live inside the per-platform package dir, and dyld/ld.so read
 * `DYLD_LIBRARY_PATH` / `LD_LIBRARY_PATH` ONCE at process start. So the addon
 * only resolves its libs when that env var already points at the platform
 * package dir when the process launches — which is exactly why the host runs in
 * a freshly-forked child: the PARENT resolves the dir here and sets the var in
 * the fork's env. On Windows the DLLs sit next to the `.node`, so no env var is
 * needed.
 *
 * Shared verbatim with @moxxy/plugin-tts-local (deliberately duplicated rather
 * than cross-imported so neither voice plugin depends on the other).
 */

import { createRequire } from 'node:module';
import path from 'node:path';

/** `${platform}-${arch}` → npm package that ships the native addon + libs.
 *  Note the Windows package is `sherpa-onnx-win-x64` (renamed from win32-x64). */
const PLATFORM_PACKAGES: Readonly<Record<string, string>> = {
  'darwin-arm64': 'sherpa-onnx-darwin-arm64',
  'darwin-x64': 'sherpa-onnx-darwin-x64',
  'linux-x64': 'sherpa-onnx-linux-x64',
  'linux-arm64': 'sherpa-onnx-linux-arm64',
  'win32-x64': 'sherpa-onnx-win-x64',
};

/** The platform binary package name for a host, or null if unsupported. */
export function sherpaPlatformPackage(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  return PLATFORM_PACKAGES[`${platform}-${arch}`] ?? null;
}

/** A `require.resolve`-shaped function (injectable for tests). */
export type ResolveLike = (request: string) => string;

/**
 * A `require.resolve` anchored at sherpa-onnx-node itself.
 *
 * Load-bearing: sherpa's per-platform binary packages are its OWN
 * `optionalDependencies`, so under pnpm's strict layout they are visible from
 * sherpa-onnx-node's `node_modules` but NOT hoisted into this plugin's — a
 * resolve anchored here would `MODULE_NOT_FOUND`. So we first resolve
 * sherpa-onnx-node, then resolve the platform package from ITS context. Cached
 * because it walks two package boundaries.
 */
let cachedSherpaResolve: ResolveLike | null | undefined;
function sherpaAnchoredResolve(): ResolveLike | null {
  if (cachedSherpaResolve !== undefined) return cachedSherpaResolve;
  try {
    const pluginRequire = createRequire(import.meta.url);
    const sherpaPkg = pluginRequire.resolve('sherpa-onnx-node/package.json');
    cachedSherpaResolve = createRequire(sherpaPkg).resolve;
  } catch {
    cachedSherpaResolve = null;
  }
  return cachedSherpaResolve;
}

/**
 * Absolute directory of the resolved platform package (which holds the `.node`
 * addon and its sibling shared libraries), or null when the package can't be
 * resolved (unsupported platform, or the optionalDependency didn't install).
 * `resolve` is injectable for tests; the default is anchored at sherpa-onnx-node.
 */
export function resolveSherpaLibDir(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  resolve?: ResolveLike,
): string | null {
  const pkg = sherpaPlatformPackage(platform, arch);
  if (!pkg) return null;
  const r = resolve ?? sherpaAnchoredResolve();
  if (!r) return null;
  try {
    return path.dirname(r(`${pkg}/package.json`));
  } catch {
    return null;
  }
}

/** The dynamic-loader env var name for a platform, or null on Windows. */
export function libraryPathVar(platform: NodeJS.Platform = process.platform): string | null {
  if (platform === 'win32') return null;
  return platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH';
}

/**
 * Build the env overrides the sidecar must launch with: the platform loader var
 * with `libDir` PREPENDED to any existing value. Returns `{}` on Windows (DLLs
 * resolve next to the addon). `existing` defaults to `process.env`.
 */
export function sherpaEnv(
  libDir: string,
  platform: NodeJS.Platform = process.platform,
  existing: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const varName = libraryPathVar(platform);
  if (!varName) return {};
  const prev = existing[varName];
  const value = prev ? `${libDir}${path.delimiter}${prev}` : libDir;
  return { [varName]: value };
}
