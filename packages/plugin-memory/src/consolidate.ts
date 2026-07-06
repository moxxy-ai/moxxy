import {
  z,
  assertDefined,
  defineTool,
  definePlugin,
  type LifecycleHooks,
  type LLMProvider,
  type Plugin,
} from '@moxxy/sdk';
import type { MemoryStore} from './store.js';
import { memoryTypeSchema, type MemoryEntry, type MemoryType } from './store.js';

const SYSTEM_PROMPT = `You are consolidating overlapping long-term memory entries.

You receive a cluster of 2 or more entries that touch the same topic. Produce a single canonical entry that:
- preserves every distinct fact from the cluster (no information loss)
- removes duplication
- keeps the body under 30 lines
- picks the most informative description (one sentence, ≤120 chars)
- inherits a single 'type' from the cluster (vote: fact / preference / project / reference)

Output ONLY a JSON object with keys: { "name", "type", "description", "body", "tags" }
where name is a kebab-case slug (use the most descriptive name from the cluster).`;

const consolidatedSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/),
  type: memoryTypeSchema,
  description: z.string().min(1).max(280),
  body: z.string().min(1).max(4000),
  tags: z.array(z.string().min(1)).optional(),
});

export interface ConsolidatePlan {
  readonly clusters: ReadonlyArray<{
    readonly key: string;
    readonly members: ReadonlyArray<string>;
  }>;
  readonly stable: ReadonlyArray<string>;
}

/**
 * Group memories into clusters by shared tag, sharing 2+ tokens in the
 * description, or both. Each cluster has at least 2 members; singletons are
 * reported as `stable` and left alone.
 */
export function planConsolidation(
  entries: ReadonlyArray<MemoryEntry>,
  opts: { tag?: string } = {},
): ConsolidatePlan {
  const tag = opts.tag;
  const filtered = tag
    ? entries.filter((e) => (e.frontmatter.tags ?? []).includes(tag))
    : entries;
  if (filtered.length < 2) {
    return { clusters: [], stable: filtered.map((e) => e.frontmatter.name) };
  }

  // Primary cluster key: a shared tag. If no tag, fall back to
  // overlap of >=2 tokens in description.
  const byTag = new Map<string, MemoryEntry[]>();
  const tagless: MemoryEntry[] = [];
  for (const e of filtered) {
    const tags = e.frontmatter.tags ?? [];
    if (tags.length === 0) {
      tagless.push(e);
    } else {
      // Use the first tag as the cluster key (deterministic, simple)
      const key = tags[0];
      assertDefined(key, 'tags is non-empty here (tags.length === 0 handled above)');
      const list = byTag.get(key) ?? [];
      list.push(e);
      byTag.set(key, list);
    }
  }

  // Description-overlap clustering for the tagless tail. O(n²) but acceptable
  // for the scale we expect (hundreds of memories).
  const descClusters: Array<{ key: string; members: MemoryEntry[] }> = [];
  for (const entry of tagless) {
    const tokens = new Set(
      tokenize(entry.frontmatter.description).concat(tokenize(entry.frontmatter.name)),
    );
    let placed = false;
    for (const cluster of descClusters) {
      const clusterTokens = new Set(cluster.members.flatMap((m) => tokenize(m.frontmatter.description)));
      const overlap = [...tokens].filter((t) => clusterTokens.has(t)).length;
      if (overlap >= 2) {
        cluster.members.push(entry);
        placed = true;
        break;
      }
    }
    if (!placed) {
      descClusters.push({ key: `desc:${entry.frontmatter.name}`, members: [entry] });
    }
  }

  const clusters: Array<{ key: string; members: ReadonlyArray<string> }> = [];
  const stable: string[] = [];

  for (const [key, members] of byTag) {
    if (members.length >= 2) {
      clusters.push({ key: `tag:${key}`, members: members.map((m) => m.frontmatter.name) });
    } else {
      const only = members[0];
      assertDefined(only, 'byTag lists always carry ≥1 member');
      stable.push(only.frontmatter.name);
    }
  }
  for (const cluster of descClusters) {
    if (cluster.members.length >= 2) {
      clusters.push({ key: cluster.key, members: cluster.members.map((m) => m.frontmatter.name) });
    } else {
      const only = cluster.members[0];
      assertDefined(only, 'desc clusters are created with ≥1 member');
      stable.push(only.frontmatter.name);
    }
  }

  return { clusters, stable };
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((t) => t.length >= 3);
}

export interface ConsolidateOptions {
  readonly tag?: string;
  readonly dryRun?: boolean;
  /**
   * Upper bound (ms) on each per-cluster provider stream. A hung/stalled
   * provider must not let `memory_consolidate` block forever — without this the
   * `for await` loop has no timeout and waits indefinitely for the next event.
   * The timeout aborts that one stream; the cluster is recorded as not-merged.
   * Default {@link DEFAULT_CONSOLIDATE_TIMEOUT_MS}. Set to 0 to disable.
   */
  readonly timeoutMs?: number;
  /** Optional caller abort (e.g. session shutdown); combined with the timeout. */
  readonly signal?: AbortSignal;
}

/** Default per-cluster provider-stream timeout for {@link consolidateMemory}. */
export const DEFAULT_CONSOLIDATE_TIMEOUT_MS = 60_000;

export interface ConsolidationOutcome {
  readonly clusters: ReadonlyArray<{
    readonly key: string;
    readonly merged: ReadonlyArray<string>;
    readonly into: string | null;
    readonly dryRun: boolean;
  }>;
  readonly stable: ReadonlyArray<string>;
}

export async function consolidateMemory(
  store: MemoryStore,
  provider: LLMProvider,
  opts: ConsolidateOptions = {},
): Promise<ConsolidationOutcome> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CONSOLIDATE_TIMEOUT_MS;
  const all = await store.list();
  const plan = planConsolidation(all, { tag: opts.tag });
  const byName = new Map(all.map((e) => [e.frontmatter.name, e]));
  // Names produced by merges earlier in THIS run. They aren't in `byName`
  // (which is a snapshot of the initial store), so without tracking them a
  // later cluster could pick the same name and silently clobber an
  // already-consolidated entry — the very data loss the collision guard exists
  // to prevent.
  const produced = new Set<string>();
  const outcomes: Array<{
    key: string;
    merged: ReadonlyArray<string>;
    into: string | null;
    dryRun: boolean;
  }> = [];

  for (const cluster of plan.clusters) {
    const members = cluster.members.map((n) => byName.get(n)).filter((e): e is MemoryEntry => Boolean(e));
    if (members.length < 2) continue;

    if (opts.dryRun) {
      outcomes.push({ key: cluster.key, merged: cluster.members, into: null, dryRun: true });
      continue;
    }

    const prompt = members
      .map(
        (m, i) =>
          `[${i + 1}] name: ${m.frontmatter.name}\ntype: ${m.frontmatter.type}\ndescription: ${m.frontmatter.description}\nbody: ${m.body}`,
      )
      .join('\n\n');

    // Bound the per-cluster stream: a hung provider must not stall consolidation
    // forever. Combine an optional caller signal with a timeout abort, and clear
    // the timer in finally so it never leaks past this cluster. We RACE each
    // iterator step against the abort signal so even a provider that ignores
    // `req.signal` (and never yields again) can't hang us — we abandon its
    // iterator and move on. The cluster is recorded as not-merged.
    const signal = combineAbort(opts.signal, timeoutMs);
    let response = '';
    let aborted = false;
    const iterable = provider.stream({
      model: provider.models[0]?.id ?? 'unknown',
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      maxTokens: 2000,
      ...(signal.signal ? { signal: signal.signal } : {}),
    });
    const iterator = iterable[Symbol.asyncIterator]();
    try {
      for (;;) {
        const step = await raceAbort(iterator.next(), signal.signal);
        if (step === ABORTED) {
          aborted = true;
          break;
        }
        if (step.done) break;
        const event = step.value;
        if (event.type === 'text_delta') response += event.delta;
        if (event.type === 'error') {
          throw new Error(`consolidate: provider error: ${event.message}`);
        }
      }
    } catch (err) {
      // A provider that honors the signal by throwing also degrades cleanly.
      if (signal.signal?.aborted || isAbortError(err)) {
        aborted = true;
      } else {
        throw err;
      }
    } finally {
      // Abandon a non-cooperative iterator so it can release resources; ignore
      // any return() error — we're already moving on.
      if (aborted) void iterator.return?.(undefined).catch(() => {});
      signal.dispose();
    }
    if (aborted) {
      console.warn(`[plugin-memory] consolidate: provider stream aborted for cluster ${cluster.key} (timeout ${timeoutMs}ms)`);
      outcomes.push({ key: cluster.key, merged: cluster.members, into: null, dryRun: false });
      continue;
    }

    const extracted = extractJson(response);
    const parsed = consolidatedSchema.parse(extracted);

    // Guard: if the LLM picked a name that already exists OUTSIDE this
    // cluster, writing it would silently clobber an unrelated memory. Skip
    // the merge and record the cluster as not-merged rather than destroy
    // data. `byName` is a snapshot taken before any provider streaming, so it
    // can be stale by now — re-read the live entry from disk to also catch an
    // entry created by a concurrent writer since the snapshot.
    const clusterNames = new Set(cluster.members);
    const liveCollision = !clusterNames.has(parsed.name) && (await store.get(parsed.name)) !== null;
    if (
      (byName.has(parsed.name) || produced.has(parsed.name) || liveCollision) &&
      !clusterNames.has(parsed.name)
    ) {
      outcomes.push({
        key: cluster.key,
        merged: cluster.members,
        into: null,
        dryRun: false,
      });
      continue;
    }

    await store.save({
      name: parsed.name,
      type: parsed.type as MemoryType,
      description: parsed.description,
      body: parsed.body,
      ...(parsed.tags ? { tags: parsed.tags } : {}),
    });
    produced.add(parsed.name);
    // Delete merged entries except the one we just saved (if it overlaps).
    for (const member of members) {
      if (member.frontmatter.name !== parsed.name) {
        await store.forget(member.frontmatter.name);
      }
    }

    outcomes.push({
      key: cluster.key,
      merged: cluster.members,
      into: parsed.name,
      dryRun: false,
    });
  }

  return { clusters: outcomes, stable: plan.stable };
}

/**
 * Combine an optional caller signal with a timeout into one AbortSignal,
 * returning a `dispose()` that clears the timer so it can't fire (and keep the
 * event loop alive) after the stream finishes. Returns `{ signal: undefined }`
 * when neither bound applies, so we don't pass an always-open signal needlessly.
 */
function combineAbort(
  caller: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal | undefined; dispose: () => void } {
  const useTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0;
  if (!caller && !useTimeout) return { signal: undefined, dispose: () => {} };
  const controller = new AbortController();
  const onAbort = () => controller.abort(caller?.reason);
  if (caller) {
    if (caller.aborted) controller.abort(caller.reason);
    else caller.addEventListener('abort', onAbort, { once: true });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (useTimeout && !controller.signal.aborted) {
    timer = setTimeout(() => controller.abort(new Error('consolidate: provider stream timed out')), timeoutMs);
    // Don't keep the process alive solely for this watchdog.
    timer.unref?.();
  }
  return {
    signal: controller.signal,
    dispose: () => {
      if (timer) clearTimeout(timer);
      caller?.removeEventListener('abort', onAbort);
    },
  };
}

/** Sentinel resolved by {@link raceAbort} when the signal fires first. */
const ABORTED = Symbol('aborted');

/**
 * Race a pending step against an abort signal. Returns the step's result if it
 * settles first, or {@link ABORTED} if the signal fires first — so a provider
 * that ignores `req.signal` and never yields again can't stall the loop. The
 * abandoned `next()` promise is left to settle on its own (its rejection, if
 * any, is swallowed); the caller stops consuming the iterator.
 */
function raceAbort<T>(
  step: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T | typeof ABORTED> {
  if (!signal) return step;
  if (signal.aborted) {
    void step.catch(() => {});
    return Promise.resolve(ABORTED);
  }
  return new Promise<T | typeof ABORTED>((resolve, reject) => {
    const onAbort = () => {
      void step.catch(() => {});
      resolve(ABORTED);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    step.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === 'AbortError') ||
    (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError')
  );
}

// Upper bound on the JSON span we'll JSON.parse from a model response. The
// consolidated entry is tiny (description ≤280, body ≤4000), so a span far
// past this is a malformed/hostile response, not a real entry — refuse it
// before handing an unbounded string to JSON.parse.
const MAX_JSON_SPAN = 64 * 1024;

function extractJson(text: string): unknown {
  // Take the span from the first `{` to the last `}` in the response. Some
  // providers wrap the object in ```json ... ```, which we strip first.
  const fenced = /```(?:json)?\n?([\s\S]*?)```/.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  // `end <= start` (e.g. a stray `}` before the first `{`) means there's no
  // well-formed object span; surface the intended message instead of letting
  // slice() yield garbage that JSON.parse fails on with an opaque error.
  if (start === -1 || end <= start) throw new Error('consolidate: model returned no JSON object');
  const span = candidate.slice(start, end + 1);
  if (span.length > MAX_JSON_SPAN) {
    throw new Error('consolidate: model JSON object too large to parse');
  }
  return JSON.parse(span);
}

export interface BuildMemoryConsolidateOptions {
  /**
   * When memory.list().length crosses this number, the plugin appends a hint
   * to the next provider request's system prompt nudging the agent to call
   * `memory_consolidate`. Default: 30. Set to 0 to disable the nudge.
   */
  readonly autoNudgeThreshold?: number;
}

/** Minimal view of the provider registry — just what consolidation needs (the
 *  active provider at call time). The host publishes the full registry under
 *  `'providers'`; this avoids importing `@moxxy/core`'s concrete type. */
interface ActiveProviderSource {
  getActive(): LLMProvider | null;
}

export function buildMemoryConsolidatePlugin(
  store: MemoryStore,
  getProvider: () => LLMProvider,
  opts: BuildMemoryConsolidateOptions = {},
): Plugin {
  // Host-injected store + provider accessor (available immediately).
  return makeMemoryConsolidatePlugin(() => store, getProvider, opts);
}

/**
 * Discovery-loadable default export: resolves the long-term store (`'memory'`,
 * published by @moxxy/plugin-memory) and the active provider (via the `'providers'`
 * registry) from the inter-plugin service registry in `onInit`, so it no longer
 * needs the `(store, getProvider)` closure. @moxxy/plugin-memory is registered
 * first, so its onInit publishes the store before this one resolves it.
 */
export const memoryConsolidatePlugin: Plugin = (() => {
  let store: MemoryStore | null = null;
  let providers: ActiveProviderSource | null = null;
  const onInit: LifecycleHooks['onInit'] = (ctx) => {
    store = ctx.services.get<MemoryStore>('memory') ?? null;
    providers = ctx.services.get<ActiveProviderSource>('providers') ?? null;
  };
  return makeMemoryConsolidatePlugin(
    () => {
      if (!store) {
        throw new Error(
          '@moxxy/memory-consolidate: the "memory" service is unavailable — @moxxy/plugin-memory must load first',
        );
      }
      return store;
    },
    () => {
      const p = providers?.getActive();
      if (!p) {
        throw new Error('@moxxy/memory-consolidate: no active provider to consolidate with');
      }
      return p;
    },
    {},
    onInit,
  );
})();

function makeMemoryConsolidatePlugin(
  getStore: () => MemoryStore,
  getProvider: () => LLMProvider,
  opts: BuildMemoryConsolidateOptions = {},
  extraOnInit?: LifecycleHooks['onInit'],
): Plugin {
  const threshold = opts.autoNudgeThreshold ?? 30;
  let nudged = false;

  const nudgeHook: LifecycleHooks =
    threshold > 0
      ? {
          onBeforeProviderCall: async (req) => {
              if (nudged) return; // one nudge per session
              // Count only — capStatus() serves the in-memory index-row cache,
              // so a below-threshold store doesn't re-scan + re-parse every
              // memory file on every single provider call for the whole session
              // (store.list() did a full disk read+parse each time).
              const count = (await getStore().capStatus()).count;
              if (count <= threshold) return;
              nudged = true;
              const hint =
                `\n\n[memory note] long-term memory has ${count} entries (threshold: ${threshold}). ` +
                `consider running \`memory_consolidate\` when there's a natural break to merge overlapping entries.`;
              return { ...req, system: (req.system ?? '') + hint };
            },
          }
        : {};

  const hooks: LifecycleHooks = extraOnInit
    ? { ...nudgeHook, onInit: extraOnInit }
    : nudgeHook;
  return definePlugin({
    name: '@moxxy/memory-consolidate',
    version: '0.0.0',
    hooks,
    tools: [
      defineTool({
        name: 'memory_consolidate',
        description:
          'Merge overlapping long-term memory entries into single canonical ones. ' +
          'Clusters by shared tag or shared tokens in name+description. ' +
          'Use dryRun=true to preview the plan without modifying anything.',
        inputSchema: z.object({
          tag: z.string().optional(),
          dryRun: z.boolean().optional().default(false),
        }),
        permission: { action: 'prompt' },
        isolation: {
          capabilities: {
            fs: { read: ['~/.moxxy/memory/**'], write: ['~/.moxxy/memory/**'] },
            // Each cluster merge streams from the active LLMProvider; the
            // inproc isolator can't pin the host (provider-config dependent).
            net: { mode: 'any' },
            // Many clusters × the 60s per-cluster provider-stream bound.
            timeMs: 600_000,
          },
        },
        handler: async ({ tag, dryRun }) => {
          const outcome = await consolidateMemory(getStore(), getProvider(), {
            ...(tag ? { tag } : {}),
            ...(dryRun !== undefined ? { dryRun } : {}),
          });
          return outcome;
        },
      }),
      defineTool({
        name: 'memory_consolidate_plan',
        description: 'Return the consolidation plan (clusters that would be merged) without invoking the model.',
        inputSchema: z.object({ tag: z.string().optional() }),
        isolation: {
          capabilities: {
            fs: { read: ['~/.moxxy/memory/**'] },
            net: { mode: 'none' },
            timeMs: 15_000,
          },
        },
        handler: async ({ tag }) => {
          const all = await getStore().list();
          return planConsolidation(all, { ...(tag ? { tag } : {}) });
        },
      }),
    ],
  });
}
