import { z } from 'zod';
import { pluginSettingsSchema } from './plugin-settings-schema.js';
import { pluginsTreeSchema } from './plugins-tree-schema.js';

export const watcherModeSchema = z.enum(['auto', 'manual', 'off']);

export const permissionsConfigSchema = z.object({
  policyPath: z.string().optional(),
  allow: z
    .array(
      z.object({
        name: z.string(),
        inputMatches: z.record(z.string(), z.string()).optional(),
        reason: z.string().optional(),
      }),
    )
    .optional(),
  deny: z
    .array(
      z.object({
        name: z.string(),
        inputMatches: z.record(z.string(), z.string()).optional(),
        reason: z.string().optional(),
      }),
    )
    .optional(),
});

export const securityConfigSchema = z.object({
  /**
   * Master toggle. When omitted or false (the default), `@moxxy/plugin-security`
   * is a no-op even if registered — every tool runs exactly as it does
   * without the plugin. Per-tool `isolation: { ... }` declarations
   * remain as documentation but are not enforced. Optional so a partial
   * `security:` block (e.g. only `isolator`) validates and config_set can
   * write one field at a time; consumers default it to false.
   */
  enabled: z.boolean().optional(),
  // The default isolator now lives in the unified tree at
  // `plugins.isolator.default` (a registry kind like any other); it is no
  // longer a bespoke `security.isolator` key.
  /**
   * Per-tool isolator overrides keyed by tool name. e.g.
   * `{ bash: 'subprocess', memory_save: 'none' }`. Falls back to the
   * default isolator above when a tool isn't listed.
   */
  perTool: z.record(z.string(), z.string()).optional(),
  /**
   * Per-plugin isolator overrides keyed by plugin name. Applies to
   * every tool the plugin contributes unless overridden in `perTool`.
   */
  perPlugin: z.record(z.string(), z.string()).optional(),
  /**
   * When true, tools without a declared `isolation` field are denied
   * outright (instead of falling through to the default isolator).
   * Useful for hardening once every in-use tool has been audited.
   */
  requireDeclaration: z.boolean().optional(),
  /**
   * Tighten the in-process input cap-check from best-effort to fail-closed.
   * By default the fs/net checks only inspect string values under a recognized
   * key name (`file`, `path`, `url`, …), so a path/URL carried by an
   * unrecognized field (`config`, `manifest`, `webhook`) is not checked. With
   * `strict: true`, any string value that is unambiguously an absolute path or a
   * bare http(s) URL is treated as in-scope-required regardless of key name, so
   * an unrecognized carrier fails closed. Consumed by `@moxxy/plugin-security`
   * (`SecurityPluginConfig.strict`); without this field the loader's schema would
   * silently strip a user's `security.strict: true` and the hardening would be
   * lost. Defaults to false at the consumer.
   */
  strict: z.boolean().optional(),
});

export const embeddingsConfigSchema = z.object({
  /**
   * 'tfidf' (default, zero deps) | 'openai' (text-embedding-3-*)
   * | 'transformers' (local, @huggingface/transformers) | 'none' (disable).
   * Optional so a partial `embeddings:` block (e.g. only `model`) validates and
   * config_set can write one field at a time; consumers default it to 'tfidf'.
   */
  provider: z.enum(['tfidf', 'openai', 'transformers', 'none']).optional(),
  model: z.string().optional(),
  dimensions: z.number().int().positive().optional(),
  apiKey: z.string().optional(),
  batchSize: z.number().int().positive().optional(),
  cacheDir: z.string().optional(),
  /** Persist computed embeddings to ~/.moxxy/memory/.embeddings.json. */
  persistIndex: z.boolean().optional(),
});

/**
 * Turn-boundary elision settings (context-on-demand). Off-by-floor safety:
 * `keepRecentTurns` never drops below 2 and elision is skipped while the
 * context is under `minContextRatioToElide` full.
 */
export const elisionConfigSchema = z.object({
  enabled: z.boolean().optional(),
  keepRecentTurns: z.number().int().min(2).optional(),
  minContextRatioToElide: z.number().min(0).max(1).optional(),
  /** Also collapse old user/assistant text turns (not just bulky tool results). */
  elideConversational: z.boolean().optional(),
  /** Auto-disable conversational elision after this many `recall({seq})` calls. */
  conversationalRecallThreshold: z.number().int().positive().optional(),
  maxRecallBytes: z.number().int().positive().optional(),
  neverElideTools: z.array(z.string()).optional(),
});

/** Context-window / token-efficiency settings. */
export const contextConfigSchema = z.object({
  /** Master switch for prompt caching. Default true (lossless). */
  caching: z.boolean().optional(),
  // The active CacheStrategy now lives at `plugins.cacheStrategy.default`.
  elision: elisionConfigSchema.optional(),
  /** Lazy tool loading: send only core + loaded tool schemas, index the rest. Default false. */
  lazyTools: z.boolean().optional(),
  /**
   * Reasoning/thinking preview. `true` enables it at the model's default depth;
   * `{ effort }` sets the depth. Honored only by providers/models that support
   * reasoning (Anthropic adaptive thinking, OpenAI/Codex reasoning). Default off.
   */
  reasoning: z
    .union([z.boolean(), z.object({ effort: z.enum(['low', 'medium', 'high']).optional() })])
    .optional(),
  /**
   * Stuck-loop guard tuning. The guard bails a turn early when the model keeps
   * making the same tool call; `maxIterations` is the hard backstop. Raise the
   * thresholds if legitimately-repeated work is being cut short, or set
   * `enabled: false` to disable the guard and rely on `maxIterations` alone.
   */
  loopGuard: z
    .object({
      enabled: z.boolean().optional(),
      windowSize: z.number().int().positive().optional(),
      repeatThreshold: z.number().int().positive().optional(),
      nearWindowSize: z.number().int().positive().optional(),
      nearThreshold: z.number().int().positive().optional(),
    })
    .strict()
    .optional(),
});

export const moxxyConfigSchema = z.object({
  /**
   * The unified plugins manifest — the single source of truth for what's
   * installed/enabled (`plugins.packages`) and the active default per category
   * (`plugins.<category>.default`). Replaces the legacy flat
   * provider/mode/compactor/workflowExecutor keys, the old `plugins:` map, and
   * `preferences.json`.
   */
  plugins: pluginsTreeSchema.optional(),
  context: contextConfigSchema.optional(),
  systemPrompt: z.string().optional(),
  maxIterations: z.number().int().positive().optional(),
  hookTimeoutMs: z.number().int().positive().optional(),
  watcher: watcherModeSchema.optional(),
  skills: z
    .object({
      projectDir: z.string().optional(),
      userDir: z.string().optional(),
      extraDirs: z.array(z.string()).optional(),
    })
    .optional(),
  security: securityConfigSchema.optional(),
  channels: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  permissions: permissionsConfigSchema.optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export type MoxxyConfig = z.infer<typeof moxxyConfigSchema>;
export type ContextConfig = z.infer<typeof contextConfigSchema>;
export type ElisionConfig = z.infer<typeof elisionConfigSchema>;
export type WatcherMode = z.infer<typeof watcherModeSchema>;
export type PermissionsConfig = z.infer<typeof permissionsConfigSchema>;
export type EmbeddingsConfig = z.infer<typeof embeddingsConfigSchema>;
export type SecurityConfig = z.infer<typeof securityConfigSchema>;

// `pluginSettingsSchema` is defined in ./plugin-settings-schema and re-exported
// here for back-references; `PluginSettings` lives there too.
export { pluginSettingsSchema };
export type { PluginSettings } from './plugin-settings-schema.js';
