import { z } from 'zod';

/** Per-package settings in the `plugins.packages` install/enable ledger. */
export const pluginSettingsSchema = z
  .object({
    /** Plug/unplug the whole package (all its contributions). Default true. */
    enabled: z.boolean().optional(),
    /** Package-specific options passed to the plugin. */
    options: z.record(z.string(), z.unknown()).optional(),
    /**
     * Optional per-contribution exclusions, e.g. `["tool:foo"]`, to suppress a
     * single contribution of an otherwise-enabled package. Honored at
     * registration time. Kept optional so the common case stays one line.
     */
    exclude: z.array(z.string()).optional(),
  })
  .strict();
export type PluginSettings = z.infer<typeof pluginSettingsSchema>;
