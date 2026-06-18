/**
 * The `moxxy-app.json` manifest — the single declarative description of a
 * desktop mini-app. A first-party app (anonymizer) ships one in its bundle; a
 * custom/third-party app is just a folder under `userData/moxxy-apps/<id>/`
 * containing this file, its `ui/` web bundle, and any installed assets. The
 * desktop discovers + validates the manifest at runtime — no recompile.
 *
 * Everything an app can do is declared here (its UI entry, the assets it
 * downloads + the hosts it may reach to do so, and the host capabilities it
 * requests), so the manifest is the complete, auditable security surface. The
 * schema is strict (`.strict()`): an unknown field is a validation error, not
 * silently ignored, so a typo never grants something unintended.
 */

import { z } from 'zod';

import { APP_PERMISSIONS } from './permissions.js';

/** A slug used as the app id AND a filesystem dir AND a `moxxy-app://` host
 *  segment — so it must be a strict, separator-free, traversal-free token. */
export const APP_ID_RE = /^[a-z][a-z0-9-]{0,62}$/;

/** A relative path inside the app dir (for `ui.entry` and asset `dest`): no
 *  absolute paths, no `..` segment, no backslashes, no NUL, no leading slash. */
const relPath = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (p) =>
      !p.includes('\0') &&
      !p.includes('\\') &&
      !p.startsWith('/') &&
      !p.split('/').some((seg) => seg === '..' || seg === ''),
    'must be a relative path with no "..", leading slash, backslash, or empty segment',
  );

/** One downloadable install asset. Mirrors the host installer's `AppAsset` so a
 *  manifest's `install.assets` drop straight into the existing download path. */
export const appAssetSchema = z
  .object({
    /** Source URL — fetched once at install (main process), host-allow-listed. */
    url: z.string().url().max(2048),
    /** Destination relative path under the app dir; also the `moxxy-app://`
     *  sub-path the UI fetches it back from. */
    dest: relPath,
    /** Advisory expected size (drives the progress bar before Content-Length). */
    bytes: z.number().int().nonnegative().optional(),
    /** Optional hex sha256, verified post-download when present. */
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional(),
  })
  .strict();

export const appInstallSchema = z
  .object({
    /** Bump to force existing installs to re-download (recorded in installed.json). */
    version: z.string().min(1).max(128),
    assets: z.array(appAssetSchema).min(1).max(256),
    /** Hostnames this app may fetch its assets FROM (exact or subdomain match).
     *  REQUIRED when there are assets — there is no global default host, so each
     *  app's egress is explicit + auditable (no app inherits another's allow-list). */
    allowedHosts: z.array(z.string().min(1).max(253)).min(1).max(32),
  })
  .strict();

export const appManifestSchema = z
  .object({
    /** Schema version — bump on a breaking manifest change. */
    manifestVersion: z.literal(1),
    id: z.string().regex(APP_ID_RE),
    name: z.string().min(1).max(80),
    description: z.string().min(1).max(400),
    /** An icon name from the host's icon set (validated against it at register
     *  time; kept a plain string here so the SDK stays UI-framework-neutral). */
    icon: z.string().min(1).max(64),
    /** App version — distinct from `install.version`; shown in the gallery. */
    version: z.string().min(1).max(64),
    /** Show the "Offline · on-device" badge. Apps that declare NO network at
     *  install (no `install`) and no networking permission are offline by nature. */
    offline: z.boolean().optional(),
    ui: z
      .object({
        /** Entry HTML relative to `<appDir>/ui/`, loaded in the sandbox iframe. */
        entry: relPath.default('index.html'),
      })
      .strict()
      .default({ entry: 'index.html' }),
    install: appInstallSchema.optional(),
    /** Host capabilities the app may call over the bridge (closed set). */
    permissions: z.array(z.enum(APP_PERMISSIONS)).max(APP_PERMISSIONS.length).default([]),
  })
  .strict();

export type AppManifest = z.infer<typeof appManifestSchema>;
export type AppAssetManifest = z.infer<typeof appAssetSchema>;

export interface ManifestParseOk {
  ok: true;
  manifest: AppManifest;
}
export interface ManifestParseError {
  ok: false;
  error: string;
}

/**
 * Parse + validate raw manifest JSON text. Returns a discriminated result (never
 * throws) so callers — the host discovery scan and the create-app skill's
 * validator — can surface a precise message for a malformed manifest without a
 * try/catch. The first zod issue is formatted as `path: message`.
 */
export function parseAppManifest(text: string): ManifestParseOk | ManifestParseError {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'manifest is not valid JSON' };
  }
  const result = appManifestSchema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? issue.path.join('.') : 'manifest';
    return { ok: false, error: `${where}: ${issue?.message ?? 'invalid manifest'}` };
  }
  return { ok: true, manifest: result.data };
}
