import type { EventLogReader } from './log.js';
import type { SessionId, TurnId } from './ids.js';
import type { ServiceRegistry } from './services.js';

/**
 * The learning-loop block — a swappable strategy that watches a finished turn
 * and *proposes* (never silently writes) memory/skill improvements. It is the
 * def-only sibling of the other single-active registries (compactor, cache
 * strategy, …) but NULLABLE: core seeds NO floor, so reflection is entirely
 * opt-in — a session with no registered reflector simply never reflects.
 *
 * The trust boundary is the "propose, don't write" contract. A reflector reads
 * the turn's events and returns {@link ReflectionProposal}s; the driver that
 * hosts it delivers those as a one-time nudge on the next provider call, phrased
 * so the *model* may choose to call `memory_save` / `synthesize_skill` — which
 * still go through the existing permission prompts. Nothing a reflector returns
 * mutates memory or skills on its own.
 */

/**
 * The context handed to {@link ReflectorDef.reflect}. Scoped to one finished
 * turn: `log.byTurn(turnId)` yields exactly that turn's events. `services`
 * exposes the host's inter-plugin registry (e.g. `services.get('providers')`
 * for a side-channel LLM pass); `signal` bounds the whole reflection (a timeout
 * and/or session shutdown) so a slow provider can never wedge it.
 */
export interface ReflectContext {
  readonly sessionId: SessionId;
  readonly turnId: TurnId;
  readonly cwd: string;
  readonly log: EventLogReader;
  readonly services: ServiceRegistry;
  readonly signal: AbortSignal;
}

/**
 * One improvement a reflector suggests. `kind` picks the target surface
 * (`'memory'` → a fact worth `memory_save`; `'skill'` → a repeated procedure
 * worth `synthesize_skill`); `title` is a short label; `nudge` is a
 * one-paragraph suggestion addressed to the assistant. A proposal is a HINT,
 * not a command — the model decides whether to act, and any resulting write
 * still hits its own permission prompt.
 */
export interface ReflectionProposal {
  readonly kind: 'memory' | 'skill';
  readonly title: string;
  /** One-paragraph suggestion addressed to the assistant. */
  readonly nudge: string;
}

/**
 * A registered reflector backend. `reflect` inspects the just-finished turn and
 * returns 0 or more proposals (an empty array = "nothing worth suggesting").
 * It MUST be side-effect-free with respect to memory/skills — it only reads and
 * proposes — and MUST honor `ctx.signal` (abort/timeout).
 */
export interface ReflectorDef {
  readonly name: string;
  readonly displayName?: string;
  reflect(ctx: ReflectContext): Promise<ReadonlyArray<ReflectionProposal>>;
}
