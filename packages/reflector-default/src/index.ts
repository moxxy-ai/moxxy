import {
  definePlugin,
  z,
  type LifecycleHooks,
  type LLMProvider,
  type MoxxyEvent,
  type Plugin,
  type ProviderRequest,
  type ReflectContext,
  type ReflectionProposal,
  type ReflectorDef,
  type SessionId,
} from '@moxxy/sdk';

/**
 * @moxxy/reflector-default — the default learning-loop block.
 *
 * TWO parts ship in one plugin:
 *   1. a {@link ReflectorDef} named `'default'` (the strategy): one cheap
 *      side-channel LLM pass over a finished turn that returns 0-2
 *      {@link ReflectionProposal}s;
 *   2. the DRIVER (lifecycle hooks): decides WHEN to reflect (a cheap gate +
 *      a one-per-session budget), runs the active reflector fire-and-forget on
 *      `onTurnEnd`, and delivers any proposals as a ONE-TIME nudge on the next
 *      `onBeforeProviderCall`.
 *
 * The load-bearing property is "propose, don't write": a proposal never mutates
 * memory or skills. It is injected into the next request's system prompt phrased
 * so the MODEL may call `memory_save` / `synthesize_skill` — which still hit
 * their own permission prompts. The reflection itself is best-effort: it runs
 * detached from the turn, catches everything, and skips silently when there is
 * no provider or the provider errors.
 */

// ── Gate thresholds ─────────────────────────────────────────────────────────
/** Reflect when a turn did at least this many tool calls (busy/procedural turn). */
export const REFLECT_MIN_TOOL_RESULTS = 5;
/** Reflect when a turn ran at least this many mode-loop rounds (a hard task). */
export const REFLECT_MIN_ITERATIONS = 8;
/** Upper bound on the whole reflection (side-channel LLM pass). */
export const REFLECT_TIMEOUT_MS = 30_000;
/** Cap on the model reply span we'll JSON-parse — past this is malformed/hostile. */
const MAX_JSON_SPAN = 32 * 1024;
/** Cap on the turn digest handed to the reflection model. */
const MAX_DIGEST_CHARS = 4000;
/** Cap on a single snippet (prompt / assistant text / one error) inside the digest. */
const MAX_SNIPPET_CHARS = 600;
/** Tokens for the reflection pass — proposals are tiny. */
const REFLECT_MAX_TOKENS = 1200;

export const REFLECT_SYSTEM_PROMPT = `You review a single finished agent turn and decide whether anything is worth remembering for the future.

Look for exactly two things:
- a durable FACT worth saving to long-term memory (a stable preference, a project detail, a hard-won answer) → kind "memory"
- a repeated multi-step PROCEDURE worth capturing as a reusable skill → kind "skill"

Be strict. Most turns warrant NOTHING. Never propose transient chit-chat, one-off values, or things already obvious from context.

When a "memory" proposal is really about WHO THE USER IS or HOW THEY WORK — a stable identity detail, a standing preference, or a personal workflow — say so in the nudge and suggest the assistant record it with \`memory_update_user_model\` (the persistent user model) rather than \`memory_save\`, which is for episodic facts.

Output ONLY a JSON array with 0, 1, or 2 items — no prose, no code fences. Each item:
  { "kind": "memory" | "skill", "title": "<= 80 chars", "nudge": "one paragraph addressed to the assistant, suggesting it consider saving this" }
Return [] when nothing is worth proposing.`;

// ── Pure helpers (exported for tests) ───────────────────────────────────────

/**
 * The cheap gate, run synchronously on `onTurnEnd` against the turn's events.
 * A turn is worth reflecting on when it was busy (≥{@link REFLECT_MIN_TOOL_RESULTS}
 * tool results), hit an error, or ground through ≥{@link REFLECT_MIN_ITERATIONS}
 * mode-loop rounds. A quiet turn (a quick Q&A) is skipped.
 */
export function shouldReflect(events: ReadonlyArray<MoxxyEvent>): boolean {
  let toolResults = 0;
  let errors = 0;
  let iterations = 0;
  for (const e of events) {
    if (e.type === 'tool_result') toolResults++;
    else if (e.type === 'error') errors++;
    else if (e.type === 'mode_iteration') iterations++;
  }
  return (
    toolResults >= REFLECT_MIN_TOOL_RESULTS || errors >= 1 || iterations >= REFLECT_MIN_ITERATIONS
  );
}

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

/**
 * Build a compact text digest of a turn from its events: the user prompt, the
 * tool names invoked (with counts), any error snippets, and the final assistant
 * text — each snippet clipped, the whole thing capped at {@link MAX_DIGEST_CHARS}.
 * This is what the reflection model reads instead of the raw event stream.
 */
export function buildTurnDigest(events: ReadonlyArray<MoxxyEvent>): string {
  const parts: string[] = [];

  const prompt = events.find((e) => e.type === 'user_prompt');
  if (prompt && prompt.type === 'user_prompt') {
    parts.push(`USER: ${clip(prompt.text, MAX_SNIPPET_CHARS)}`);
  }

  const toolCounts = new Map<string, number>();
  for (const e of events) {
    if (e.type === 'tool_call_requested') {
      toolCounts.set(e.name, (toolCounts.get(e.name) ?? 0) + 1);
    }
  }
  if (toolCounts.size > 0) {
    const list = [...toolCounts.entries()]
      .map(([name, n]) => (n > 1 ? `${name}×${n}` : name))
      .join(', ');
    parts.push(`TOOLS: ${list}`);
  }

  const errorSnippets: string[] = [];
  for (const e of events) {
    if (e.type === 'tool_result' && e.ok === false && e.error?.message) {
      errorSnippets.push(clip(e.error.message, 200));
    } else if (e.type === 'error') {
      errorSnippets.push(clip(e.message, 200));
    }
  }
  if (errorSnippets.length > 0) {
    parts.push(`ERRORS: ${errorSnippets.slice(0, 5).join(' | ')}`);
  }

  // Last finalized assistant message is the turn's conclusion.
  let finalText: string | null = null;
  for (const e of events) {
    if (e.type === 'assistant_message' && e.content.trim()) finalText = e.content;
  }
  if (finalText) parts.push(`ASSISTANT: ${clip(finalText, MAX_SNIPPET_CHARS)}`);

  return clip(parts.join('\n'), MAX_DIGEST_CHARS);
}

const proposalSchema = z.object({
  kind: z.enum(['memory', 'skill']),
  title: z.string().min(1).max(200),
  nudge: z.string().min(1).max(2000),
});
const proposalsSchema = z.array(proposalSchema);

/**
 * Defensively parse the reflection model's reply into 0-2 proposals. Strips an
 * optional ```json fence, takes the first `[` … last `]` span, refuses an
 * oversized span, JSON-parses, validates each item, and clamps to 2. ANY
 * failure (no array, malformed JSON, wrong shape) yields `[]` — a bad reply
 * silently produces no nudge rather than throwing into the detached reflection.
 */
export function parseReflectionReply(text: string): ReflectionProposal[] {
  try {
    const fenced = /```(?:json)?\n?([\s\S]*?)```/.exec(text);
    const candidate = fenced ? fenced[1]! : text;
    const start = candidate.indexOf('[');
    const end = candidate.lastIndexOf(']');
    if (start === -1 || end <= start) return [];
    const span = candidate.slice(start, end + 1);
    if (span.length > MAX_JSON_SPAN) return [];
    const parsed = proposalsSchema.safeParse(JSON.parse(span));
    if (!parsed.success) return [];
    return parsed.data.slice(0, 2).map((p) => ({ kind: p.kind, title: p.title, nudge: p.nudge }));
  } catch {
    return [];
  }
}

/**
 * The one-time nudge injected into the next provider request's system prompt.
 * Phrased as a suggestion the model MAY act on via `memory_save` /
 * `synthesize_skill` (each of which asks the user for permission) — never a
 * directive, never a silent write.
 */
export function buildNudgeBlock(proposals: ReadonlyArray<ReflectionProposal>): string {
  const lines = proposals.map((p) => `- (${p.kind}) ${p.title}: ${p.nudge}`).join('\n');
  return (
    `\n\n[reflection] A background review of the last turn surfaced ${proposals.length} ` +
    `suggestion(s) you MAY act on if genuinely useful (otherwise ignore):\n${lines}\n` +
    'To persist one, you may call `memory_save` (a durable fact) or `synthesize_skill` ' +
    '(a repeatable procedure) — each asks the user for permission first. Do not act unless it clearly helps.'
  );
}

// ── The `default` reflector (the strategy) ──────────────────────────────────

/** Minimal view of the provider registry the reflection pass needs. */
interface ActiveProviderSource {
  getActiveName(): string | null;
  getActive(): LLMProvider;
}

/** Collect a provider stream into text, honoring the abort signal. */
async function streamText(provider: LLMProvider, req: ProviderRequest): Promise<string> {
  let out = '';
  const iterable = provider.stream(req);
  const iterator = iterable[Symbol.asyncIterator]();
  try {
    for (;;) {
      if (req.signal?.aborted) break;
      const step = await raceAbort(iterator.next(), req.signal);
      if (step === ABORTED) break;
      if (step.done) break;
      const event = step.value;
      if (event.type === 'text_delta') out += event.delta;
      else if (event.type === 'error') throw new Error(event.message);
    }
  } finally {
    if (req.signal?.aborted) void iterator.return?.(undefined).catch(() => {});
  }
  return out;
}

const ABORTED = Symbol('aborted');
function raceAbort<T>(step: Promise<T>, signal: AbortSignal | undefined): Promise<T | typeof ABORTED> {
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

/**
 * The default reflector: one cheap side-channel LLM pass over the finished
 * turn. Resolves the active provider from the service registry, streams a
 * strict-JSON reply, and parses it into 0-2 proposals. Returns `[]` (never
 * throws) when there is no active provider or the provider errors — reflection
 * degrades to a no-op rather than surfacing anything into the session.
 */
export const reflectorDefaultDef: ReflectorDef = {
  name: 'default',
  displayName: 'Default learning loop',
  async reflect(ctx: ReflectContext): Promise<ReadonlyArray<ReflectionProposal>> {
    const providers = ctx.services.get<ActiveProviderSource>('providers');
    // Graceful no-provider skip: nothing to reflect with.
    if (!providers || providers.getActiveName() == null) return [];
    let provider: LLMProvider;
    try {
      provider = providers.getActive();
    } catch {
      return [];
    }

    const digest = buildTurnDigest(ctx.log.byTurn(ctx.turnId));
    if (!digest) return [];

    const req: ProviderRequest = {
      model: provider.models[0]?.id ?? 'unknown',
      system: REFLECT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [{ type: 'text', text: digest }] }],
      maxTokens: REFLECT_MAX_TOKENS,
      signal: ctx.signal,
    };
    try {
      const reply = await streamText(provider, req);
      return parseReflectionReply(reply);
    } catch {
      // Provider error / abort → degrade to a no-op rather than surfacing.
      return [];
    }
  },
};

// ── The driver (lifecycle hooks) ────────────────────────────────────────────

/** Per-session reflection budget: window = the whole session for v1. */
export interface SessionBudget {
  /** Reflections fired this window (v1 cap = 1). */
  readonly count: number;
  /** Seq of the last turn's last event reflected on (future windowing aid). */
  readonly lastSeq: number;
}

/** Minimal view of the reflector registry the driver resolves the active def from. */
interface ActiveReflectorSource {
  getActive(): ReflectorDef | null;
}

/** Test-facing handle into the driver's private per-session state. */
export interface ReflectorInternals {
  /** Await the (fire-and-forget) reflection kicked off for a session, if any. */
  settle(sessionId: SessionId): Promise<void>;
  /** The pending one-time nudge for a session, or null. */
  pendingNudge(sessionId: SessionId): string | null;
  /** The session's reflection budget, or undefined when it never fired the gate. */
  budget(sessionId: SessionId): SessionBudget | undefined;
}

export interface BuildReflectorPluginResult {
  readonly plugin: Plugin;
  readonly internals: ReflectorInternals;
}

/**
 * Build the reflector plugin. The default export calls this with no options;
 * tests use the returned `internals` handle to await the detached reflection
 * and inspect the budget / pending nudge deterministically.
 */
export function buildReflectorPlugin(): BuildReflectorPluginResult {
  // All keyed by sessionId so one shared instance stays correct across the many
  // sessions a runner hosts in one process; every map self-cleans in onShutdown.
  const budgets = new Map<SessionId, SessionBudget>();
  const pending = new Map<SessionId, string>();
  const inFlight = new Map<SessionId, Promise<void>>();
  const shutdownControllers = new Map<SessionId, AbortController>();

  function cleanup(sessionId: SessionId): void {
    try {
      shutdownControllers.get(sessionId)?.abort();
    } catch {
      // aborting a controller never throws in practice; guard anyway.
    }
    shutdownControllers.delete(sessionId);
    budgets.delete(sessionId);
    pending.delete(sessionId);
    inFlight.delete(sessionId);
  }

  const hooks: LifecycleHooks = {
    // AWAITED by the lifecycle dispatcher (with a per-plugin timeout), so this
    // MUST return fast: the gate + budget check are synchronous, and the actual
    // reflection is kicked off FIRE-AND-FORGET (a guarded detached promise) so
    // it never blocks the turn and can never throw into it.
    onTurnEnd(ctx) {
      try {
        const events = ctx.log.byTurn(ctx.turnId);
        if (!shouldReflect(events)) return;

        const prior = budgets.get(ctx.sessionId) ?? { count: 0, lastSeq: -1 };
        // Budget: at most one reflection per session window (v1 = whole session).
        if (prior.count >= 1) return;

        const reflectors = ctx.services.get<ActiveReflectorSource>('reflectors');
        const reflector = reflectors?.getActive() ?? null;
        // Nullable registry: no active reflector → reflection is off. Do NOT
        // consume the budget (so activating one later still gets a chance).
        if (!reflector) return;

        // Reserve the budget slot BEFORE going async so a rapid next turn can't
        // double-fire while this reflection is still in flight.
        const lastSeq = events.length > 0 ? events[events.length - 1]!.seq : prior.lastSeq;
        budgets.set(ctx.sessionId, { count: prior.count + 1, lastSeq });

        let sc = shutdownControllers.get(ctx.sessionId);
        if (!sc) {
          sc = new AbortController();
          shutdownControllers.set(ctx.sessionId, sc);
        }
        const signal = AbortSignal.any([sc.signal, AbortSignal.timeout(REFLECT_TIMEOUT_MS)]);
        const reflectCtx: ReflectContext = {
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          cwd: ctx.cwd,
          log: ctx.log,
          services: ctx.services,
          signal,
        };

        const p = (async () => {
          try {
            const proposals = await reflector.reflect(reflectCtx);
            if (proposals.length > 0) pending.set(ctx.sessionId, buildNudgeBlock(proposals));
          } catch {
            // Best-effort: a no-provider skip, provider error, or reflector
            // throw must never surface. The budget stays spent (one attempt).
          }
        })();
        inFlight.set(ctx.sessionId, p);
        // Detach: do NOT return `p` — onTurnEnd resolves immediately.
        void p;
      } catch {
        // The gate itself (a hostile log reader, etc.) must never take down the
        // awaited onTurnEnd hook.
      }
    },

    // Deliver a pending reflection as a ONE-TIME nudge on the next provider call.
    onBeforeProviderCall(req, ctx) {
      const nudge = pending.get(ctx.sessionId);
      if (!nudge) return;
      pending.delete(ctx.sessionId); // one-shot: cleared after injection
      return { ...req, system: (req.system ?? '') + nudge };
    },

    onShutdown(ctx) {
      cleanup(ctx.sessionId);
    },
  };

  const plugin = definePlugin({
    name: '@moxxy/reflector-default',
    version: '0.0.0',
    reflectors: [reflectorDefaultDef],
    hooks,
  });

  const internals: ReflectorInternals = {
    async settle(sessionId) {
      await inFlight.get(sessionId)?.catch(() => {});
    },
    pendingNudge: (sessionId) => pending.get(sessionId) ?? null,
    budget: (sessionId) => budgets.get(sessionId),
  };

  return { plugin, internals };
}

/** Discovery-loadable default export (the plain plugin, no test handle). */
const reflectorPlugin: Plugin = buildReflectorPlugin().plugin;
export default reflectorPlugin;
