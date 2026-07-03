import { z } from 'zod';

const pluginKindSchema = z.enum([
  'tools',
  'provider',
  'mode',
  'compactor',
  'cache-strategy',
  'view-renderer',
  'tunnel-provider',
  'mcp',
  'cli',
  'channel',
  'hooks',
  'agent',
  'command',
  'transcriber',
  'synthesizer',
  'reflector',
]);

export const requirementSchema = z.object({
  kind: z.enum([
    'plugin',
    'provider',
    'tool',
    'transcriber',
    'synthesizer',
    'mode',
    'compactor',
    'channel',
    'agent',
    'command',
    'runtime',
  ]),
  name: z.string().min(1),
  state: z.enum(['registered', 'active', 'ready']).optional(),
  version: z.string().min(1).optional(),
  optional: z.boolean().optional(),
  reason: z.string().min(1).optional(),
  hint: z.string().min(1).optional(),
});

/**
 * Optional schedule block on a skill. When present, the scheduler
 * plugin (if installed) automatically registers a recurring or one-shot
 * trigger that runs the skill body as a prompt. Either `cron` or
 * `runAt` must be set; supplying both is rejected by the scheduler.
 */
export const skillScheduleSchema = z
  .object({
    cron: z.string().min(1).optional(),
    runAt: z
      .union([z.number().int(), z.string().min(1)])
      .optional(),
    timeZone: z.string().min(1).optional(),
    channel: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => !!v.cron || v.runAt !== undefined, {
    message: 'schedule needs either `cron` or `runAt`',
  });

export const skillFrontmatterSchema = z.object({
  name: z.string().min(1).max(120).regex(/^[a-z0-9][a-z0-9-]*$/, 'name must be slug-like'),
  description: z.string().min(1).max(240),
  triggers: z.array(z.string().min(1)).optional(),
  'allowed-tools': z.array(z.string().min(1)).optional(),
  version: z.string().optional(),
  tags: z.array(z.string().min(1)).optional(),
  /** Opt the skill into automatic recurring/one-shot execution. */
  schedule: skillScheduleSchema.optional(),
});

export const pluginManifestSchema = z.object({
  entry: z.string().min(1),
  kind: z
    .union([pluginKindSchema, z.array(pluginKindSchema)])
    .optional(),
  skills: z.string().optional(),
});

/**
 * Shape of a package's `moxxy` field in package.json.
 *
 * - `plugin` — the per-package plugin manifest (`entry`, `kind`, `skills`).
 *   When omitted the package is not treated as a moxxy plugin.
 * - `requirements` — declarative prerequisites that gate plugin
 *   registration and drive load-order toposort. This is the SINGLE place
 *   requirements may be authored; per-tool/per-transcriber/per-anything
 *   runtime declarations were removed in favor of static analysis.
 */
/**
 * One field of a plugin's declarative setup step (`package.json#moxxy.setup`).
 * Declarative-only so EVERY frontend (the init wizard, the TUI, desktop
 * onboarding) can render it without executing plugin code:
 * - `secret` values land in the VAULT (never plaintext config); the plugin's
 *   `options.<key>` gets a `${vault:<name>}` ref, resolved at boot.
 * - other kinds land at `plugins.packages.<pkg>.options.<key>` in the user
 *   config through the shared schema-validated writer.
 */
export const pluginSetupFieldSchema = z.object({
  key: z.string().min(1).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'key must be an identifier'),
  label: z.string().min(1),
  description: z.string().optional(),
  kind: z.enum(['secret', 'string', 'boolean', 'select']),
  /** Vault entry name for `secret` fields. Default: `<PKG>_<KEY>` upper-snake. */
  vaultKey: z.string().min(1).optional(),
  /** Choices for `select` fields. */
  options: z.array(z.string().min(1)).optional(),
  /** Required fields block completion; optional ones may stay unset. */
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
});

/**
 * A plugin's declarative configuration step, walked by `moxxy init` (and
 * surfaced after an on-demand install). `required: true` means the plugin is
 * left DISABLED until its required fields are provided — the author's way to
 * say "this cannot work unconfigured".
 */
export const pluginSetupSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean().optional(),
  fields: z.array(pluginSetupFieldSchema).min(1),
});

export const moxxyPackageSchema = z.object({
  plugin: pluginManifestSchema.optional(),
  requirements: z.array(requirementSchema).optional(),
  /** Declarative setup step users walk through in init / post-install. */
  setup: pluginSetupSchema.optional(),
});

export type PluginSetupField = z.infer<typeof pluginSetupFieldSchema>;
export type PluginSetupSpec = z.infer<typeof pluginSetupSchema>;
export type SkillFrontmatterInput = z.infer<typeof skillFrontmatterSchema>;
export type PluginManifestInput = z.infer<typeof pluginManifestSchema>;
export type MoxxyPackageInput = z.infer<typeof moxxyPackageSchema>;
