/**
 * How deeply a reasoning model thinks, lowest first. `max` is the deepest
 * thinking; `ultra` is `max` that may also hand parts of the task to subagents
 * (Codex). Not every model takes every level: a model names its own in
 * `ModelDescriptor.reasoningEfforts`.
 */
export const REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** What a reasoning model that names no levels takes: the four every reasoning provider understands. */
export const CLASSIC_REASONING_EFFORTS: ReadonlyArray<ReasoningEffort> = ['low', 'medium', 'high', 'xhigh'];

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && (REASONING_EFFORTS as ReadonlyArray<string>).includes(value);
}

const rank = (effort: ReasoningEffort): number => REASONING_EFFORTS.indexOf(effort);

/** The levels Moxxy knows out of what an agent or API reports, once each, lowest first. */
export function reasoningEffortsFrom(values: ReadonlyArray<unknown>): ReasoningEffort[] {
  return REASONING_EFFORTS.filter((effort) => values.includes(effort));
}

/** The levels a model takes: the ones it names, else the classic four. */
export function reasoningEffortsOf(
  model: { readonly reasoningEfforts?: ReadonlyArray<ReasoningEffort> } | undefined,
): ReadonlyArray<ReasoningEffort> {
  const named = model?.reasoningEfforts;
  return named && named.length > 0 ? reasoningEffortsFrom(named) : CLASSIC_REASONING_EFFORTS;
}

/** The levels any of these models takes, lowest first; none when none of them reasons. */
export function reasoningLevelsOf(
  models: ReadonlyArray<{ readonly supportsReasoning?: boolean; readonly reasoningEfforts?: ReadonlyArray<ReasoningEffort> }>,
): ReadonlyArray<ReasoningEffort> {
  return reasoningEffortsFrom(models.flatMap((m) => (m.supportsReasoning === true ? reasoningEffortsOf(m) : [])));
}

/**
 * The level a model runs a wanted one at: the wanted level when the model takes
 * it, else the highest it takes below it (ultra on a model that stops at max
 * runs at max), else its lowest. A model that names no levels keeps the wanted one.
 */
export function fitReasoningEffort(wanted: ReasoningEffort, offered: ReadonlyArray<ReasoningEffort>): ReasoningEffort {
  if (offered.length === 0 || offered.includes(wanted)) return wanted;
  const ordered = reasoningEffortsFrom(offered);
  const below = ordered.filter((effort) => rank(effort) < rank(wanted));
  return below.at(-1) ?? ordered[0] ?? wanted;
}

/**
 * A turn's reasoning as one request to a model asks for it: its effort fitted
 * to the levels the model takes. A model Moxxy has no description of (a custom
 * id) gets the level as it is, for its agent or API to judge.
 */
export function fitReasoningRequest<R extends { readonly effort?: ReasoningEffort } | boolean | undefined>(
  reasoning: R,
  model: { readonly reasoningEfforts?: ReadonlyArray<ReasoningEffort> } | undefined,
): R {
  if (!model || typeof reasoning !== 'object' || reasoning === null || reasoning.effort === undefined) return reasoning;
  const fitted = fitReasoningEffort(reasoning.effort, reasoningEffortsOf(model));
  return fitted === reasoning.effort ? reasoning : { ...reasoning, effort: fitted };
}
