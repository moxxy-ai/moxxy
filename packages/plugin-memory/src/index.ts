import { defineTool, defineEmbedder, definePlugin, z, type Plugin, type ProviderRequest } from '@moxxy/sdk';
import { MemoryStore, memoryTypeSchema, type MemoryStoreOptions } from './store.js';
import { TfIdfEmbedder } from './tfidf.js';
import { UserModelStore, userModelTool } from './user-model.js';

export {
  MemoryStore,
  memoryTypeSchema,
  memoryFrontmatterSchema,
  defaultMemoryDir,
  type MemoryEntry,
  type MemoryFrontmatter,
  type MemoryStoreOptions,
  type MemoryType,
  type RankedMemory,
  type RecallMode,
} from './store.js';
export { parseMdFile, parseFrontmatter, renderFrontmatter } from './parse.js';
export { recentExchanges, summarizeSession, type SessionFact } from './stm.js';
export { TfIdfEmbedder, cosineSimilarity, tokenize } from './tfidf.js';
export { EmbeddingIndex } from './embedding-cache.js';
export {
  UserModelStore,
  userModelTool,
  parseUserModel,
  serializeUserModel,
  renderInjectionBody,
  defaultUserModelPath,
  MAX_INJECTED_CHARS,
  USER_MODEL_OPEN,
  USER_MODEL_CLOSE,
  FIXED_SECTIONS,
  SECTION_TITLES,
  type UserModel,
  type UserModelSection,
  type UserModelSectionKey,
  type UserModelUpdateMode,
} from './user-model.js';
export {
  planConsolidation,
  consolidateMemory,
  buildMemoryConsolidatePlugin,
  memoryConsolidatePlugin,
  type ConsolidatePlan,
  type ConsolidateOptions,
  type ConsolidationOutcome,
} from './consolidate.js';
import { memoryConsolidatePlugin as memoryConsolidatePluginRef } from './consolidate.js';

export interface BuildMemoryPluginOptions extends MemoryStoreOptions {}

export function buildMemoryPlugin(opts: BuildMemoryPluginOptions = {}): { plugin: Plugin; store: MemoryStore } {
  const store = new MemoryStore(opts);
  // The persistent user model lives alongside the episodic memories in the same
  // memory dir. Both the always-on injection hook and the update tool close over
  // this one instance so the mtime cache is shared.
  const userModel = new UserModelStore(opts.dir);
  const plugin = definePlugin({
    name: '@moxxy/plugin-memory',
    version: '0.0.0',
    // Publish the long-term store on the inter-plugin service registry so the
    // sibling @moxxy/memory-consolidate plugin can resolve it in its own onInit
    // instead of being hand-built with the store — the seam that lets both be
    // discovery-loaded. memory-consolidate is registered after this plugin, so
    // this onInit runs first.
    hooks: {
      onInit: (ctx) => {
        ctx.services.register('memory', store);
      },
      // ALWAYS-ON: prepend the delimited <user-model> block to every provider
      // call when the file exists and has content. Idempotent (skips when the
      // block is already present) and error-swallowing (never breaks a call).
      onBeforeProviderCall: (req) => userModel.injectInto(req),
    },
    // The zero-dep TF-IDF embedder, contributed as a selectable embedder so it
    // sits in the same registry as openai/transformers/custom ones.
    embedders: [
      defineEmbedder({
        name: 'tfidf',
        displayName: 'TF-IDF (built-in, zero-dep)',
        createClient: () => new TfIdfEmbedder(),
      }),
    ],
    tools: [
      defineTool({
        name: 'memory_save',
        description:
          'Persist a memory to long-term storage. Use sparingly — only for facts/preferences/' +
          'project context that would help you in future sessions. Keep the body terse.',
        inputSchema: z.object({
          name: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/, 'name must be slug-like'),
          type: memoryTypeSchema,
          description: z.string().min(1).max(280),
          body: z.string().min(1).max(4000),
          tags: z.array(z.string().min(1)).optional(),
        }),
        permission: { action: 'prompt' },
        isolation: {
          capabilities: {
            fs: { read: ['~/.moxxy/memory/**'], write: ['~/.moxxy/memory/**'] },
            net: { mode: 'none' },
            timeMs: 5_000,
          },
        },
        handler: async ({ name, type, description, body, tags }) => {
          const saved = await store.save({ name, type, description, body, tags });
          const cap = await store.capStatus();
          return {
            name: saved.frontmatter.name,
            path: saved.path,
            // Warn-only soft cap: the save succeeded, but tell the model the
            // store is overgrown so it consolidates / forgets stale entries.
            ...(cap.over
              ? {
                  warning:
                    `memory store holds ${cap.count} entries (soft cap ${cap.max}). ` +
                    `Nothing was evicted — consider consolidating related memories or using memory_forget on stale ones.`,
                }
              : {}),
          };
        },
      }),
      defineTool({
        name: 'memory_recall',
        description:
          'Search long-term memory by free-text query. Uses vector similarity (TF-IDF by default, ' +
          'or a configured EmbeddingProvider) when mode is "auto" or "vector". Returns the most ' +
          'relevant entries with their full bodies.',
        inputSchema: z.object({
          query: z.string().min(1),
          limit: z.number().int().min(1).max(20).optional().default(5),
          type: memoryTypeSchema.optional(),
          mode: z.enum(['auto', 'vector', 'keyword']).optional().default('auto'),
        }),
        isolation: {
          capabilities: {
            fs: { read: ['~/.moxxy/memory/**'] },
            // Vector recall may call out to an EmbeddingProvider (OpenAI,
            // local transformers, …). The inproc isolator can't enforce
            // this; a stronger isolator should constrain to the actual
            // configured embedder's host.
            net: { mode: 'any' },
            timeMs: 15_000,
          },
        },
        handler: async ({ query, limit, type, mode }) => {
          const matches = await store.recall(query, { limit, type, mode });
          return matches.map(({ entry, score }) => ({
            name: entry.frontmatter.name,
            type: entry.frontmatter.type,
            description: entry.frontmatter.description,
            body: entry.body,
            score,
          }));
        },
      }),
      defineTool({
        name: 'memory_list',
        description: 'List all stored memories (name + type + description, no body).',
        inputSchema: z.object({ type: memoryTypeSchema.optional() }),
        isolation: {
          capabilities: {
            fs: { read: ['~/.moxxy/memory/**'] },
            net: { mode: 'none' },
            timeMs: 5_000,
          },
        },
        handler: async ({ type }) => {
          const entries = await store.list(type);
          return entries.map((e) => ({
            name: e.frontmatter.name,
            type: e.frontmatter.type,
            description: e.frontmatter.description,
            tags: e.frontmatter.tags ?? [],
          }));
        },
      }),
      defineTool({
        name: 'memory_forget',
        description: 'Delete a memory by name. Use only when the memory is incorrect or no longer relevant.',
        // Slug-only name: the inproc isolator does NOT enforce the fs.write glob,
        // so this Zod guard is the sole defense against a path-traversal `name`
        // (e.g. '../../vault') reaching fs.unlink. Mirror memory_save's regex.
        inputSchema: z.object({
          name: z.string().min(1).max(120).regex(/^[a-z0-9][a-z0-9-]*$/, 'name must be slug-like'),
        }),
        permission: { action: 'prompt' },
        isolation: {
          capabilities: {
            fs: { read: ['~/.moxxy/memory/**'], write: ['~/.moxxy/memory/**'] },
            net: { mode: 'none' },
            timeMs: 5_000,
          },
        },
        handler: async ({ name }) => {
          const removed = await store.forget(name);
          return removed ? `forgot ${name}` : `not found: ${name}`;
        },
      }),
      defineTool({
        name: 'memory_update',
        description: 'Update an existing memory in place. createdAt is preserved; updatedAt bumps.',
        inputSchema: z.object({
          // Slug-only: see memory_forget — the schema is the only traversal guard.
          name: z.string().min(1).max(120).regex(/^[a-z0-9][a-z0-9-]*$/, 'name must be slug-like'),
          description: z.string().min(1).max(280).optional(),
          body: z.string().min(1).max(4000).optional(),
          tags: z.array(z.string().min(1)).optional(),
        }),
        permission: { action: 'prompt' },
        isolation: {
          capabilities: {
            fs: { read: ['~/.moxxy/memory/**'], write: ['~/.moxxy/memory/**'] },
            net: { mode: 'none' },
            timeMs: 5_000,
          },
        },
        handler: async ({ name, description, body, tags }) => {
          const updated = await store.update(name, { description, body, tags });
          if (!updated) throw new Error(`memory '${name}' not found`);
          return { name: updated.frontmatter.name, updatedAt: updated.frontmatter.updatedAt };
        },
      }),
      userModelTool(userModel),
    ],
  });
  return { plugin, store };
}


/**
 * Discovery-loadable instance: the WHOLE memory feature (long-term store +
 * memory_save/recall/… tools + the tfidf embedder + memory_consolidate and
 * its nudge hooks) as ONE plugin, so the package unbundles cleanly — the
 * loader takes a single default export per package. Composition over the
 * existing builders:
 *  - the store's embedder resolves LAZILY from the host-published
 *    'embedders' registry service (captured in onInit, read on first
 *    recall), replacing the bootstrap closure the CLI used to inject;
 *  - our onInit registers the 'memory' service FIRST, then runs
 *    consolidate's onInit, which resolves it — same ordering the two
 *    separate builtin entries relied on.
 * `buildMemoryPlugin` stays for hosts/tests that inject their own store.
 */
export const memoryPlugin: Plugin = (() => {
  let embeddersReg: { tryGetActive(): unknown } | null = null;
  const { plugin: base } = buildMemoryPlugin({
    // The registry hands back an EmbedderClient-compatible instance; the
    // structural cast keeps this file free of a core import.
    embedder: () =>
      (embeddersReg?.tryGetActive() ?? null) as ReturnType<
        Extract<NonNullable<MemoryStoreOptions['embedder']>, () => unknown>
      >,
  });
  const consolidate = memoryConsolidatePluginRef;
  return definePlugin({
    name: '@moxxy/plugin-memory',
    version: '0.0.0',
    ...(base.embedders ? { embedders: base.embedders } : {}),
    tools: [...(base.tools ?? []), ...(consolidate.tools ?? [])],
    hooks: {
      onInit: async (ctx) => {
        embeddersReg =
          ctx.services.get<{ tryGetActive(): unknown }>('embedders') ?? null;
        await base.hooks?.onInit?.(ctx);
        await consolidate.hooks?.onInit?.(ctx);
      },
      // A Plugin has a single onBeforeProviderCall, but this composed plugin
      // carries TWO: base's always-on user-model injection and consolidate's
      // once-per-session nudge. Chain them so both run (injection prepends its
      // block, the nudge appends its hint); either may return void to pass through.
      onBeforeProviderCall: async (req, ctx) => {
        let out: ProviderRequest | undefined;
        const injected = await base.hooks?.onBeforeProviderCall?.(out ?? req, ctx);
        if (injected) out = injected;
        const nudged = await consolidate.hooks?.onBeforeProviderCall?.(out ?? req, ctx);
        if (nudged) out = nudged;
        return out;
      },
    },
  });
})();

// Discovery entry: `createPluginLoader` requires a default Plugin export.
export default memoryPlugin;
