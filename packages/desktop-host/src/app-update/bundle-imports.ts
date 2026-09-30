import { builtinModules } from 'node:module';

/**
 * Loaded behind a try/catch or a guarded dynamic import and absent on purpose:
 * `EXTERNAL_OPTIONAL` in apps/desktop/electron.vite.config.ts, plus `encoding`
 * (node-fetch's optional charset converter).
 */
const OPTIONAL = new Set(['@napi-rs/keyring', 'bufferutil', 'utf-8-validate', 'puppeteer', 'encoding']);
const BUILTIN = new Set(builtinModules);
// A static import/export starts a statement (a line, or after `;` in
// minified output) — the same words inside a string or comment don't. A
// dynamic import or `require` is a call, not a method like
// `ctx.services.require(…)`.
const IMPORT =
  /(?:^|;)[ \t]*(?:import|export)\s*(?:[\w*${}\s,]+?\s*from\s*)?["']([^"'\n]+)["']|(?<![.\w$])import\(\s*["']([^"'\n]+)["']\s*\)|(?<![.\w$])require\(\s*["']([^"'\n]+)["']\s*\)/gm;
/** What npm accepts as a package name — a template or prose fragment is not one. */
const PACKAGE_NAME = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/;

const packageName = (spec: string): string =>
  spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : (spec.split('/')[0] ?? spec);

/**
 * Packages the bundle's main or preload imports but does not carry. A staged
 * bundle has no `node_modules`, so each of them fails the boot.
 */
export function unbundledImports(files: Readonly<Record<string, Buffer>>): string[] {
  const missing = new Set<string>();
  for (const [rel, buf] of Object.entries(files)) {
    if (!rel.startsWith('dist-electron/') || !/\.[cm]?js$/.test(rel)) continue;
    for (const match of buf.toString('utf8').matchAll(IMPORT)) {
      const spec = match[1] ?? match[2] ?? match[3];
      if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue;
      const name = packageName(spec);
      if (!PACKAGE_NAME.test(name) || name === 'electron' || BUILTIN.has(name) || OPTIONAL.has(name)) continue;
      missing.add(name);
    }
  }
  return [...missing].sort();
}
