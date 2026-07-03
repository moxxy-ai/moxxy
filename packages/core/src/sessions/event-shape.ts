/**
 * Runtime shape guard for event-log lines — the read side of the EventStore
 * trust boundary.
 *
 * The per-session JSONL is parsed back into `MoxxyEvent`s on every resume/
 * attach (`restoreEvents`), every history page (`readEventPage`), and every
 * index hydration (`matchingSessionStatsFromLog`). Corrupt-JSON lines were
 * always skipped, but a structurally-valid-but-wrong-shape line used to be
 * CAST straight to `MoxxyEvent` and then drive replay and state
 * reconstruction — e.g. a `compaction` line missing `replacedRange`/`summary`
 * throws inside `projectMessagesFromLog`'s unconditional
 * `event.summary.trim()` / `event.replacedRange[0]` dereferences, mid-replay.
 * This guard closes that gap: wrong-shape lines are skipped with the exact
 * same semantics as corrupt lines (never throw, never truncate what follows).
 *
 * CALIBRATION — why this is a shallow structural check, not a full schema:
 *
 * `restoreEvents` REWRITES the repaired log after skipping bad lines, so a
 * false positive here permanently deletes history. The guard therefore
 * rejects only shapes that would actively corrupt replay, and tolerates
 * benign drift:
 *
 *  - Envelope: strict on the fields the replay machinery itself dereferences
 *    (`id`, `seq`, `ts`, `type` — mirrors dedupe by `id`, ingest/paging/
 *    re-sequencing key on numeric `seq`). Lenient-if-present on `sessionId` /
 *    `turnId` / `source`: the existing session-ownership path already
 *    tolerates and normalizes a missing `sessionId`
 *    (`eventBelongsToSession`), and none of these are dereferenced in a way
 *    that can throw.
 *  - Unknown `type` with a valid envelope is KEPT, not dropped: every
 *    downstream fold pattern-matches known types and ignores the rest (there
 *    is no exhaustive-switch throw), and the desktop floor mechanism makes
 *    "older core replaying a newer log" a designed scenario — dropping (and
 *    then rewriting away) a newer version's events on rollback would be
 *    silent history loss. This matches the pre-guard behavior for that class
 *    of line exactly.
 *  - Known `type`: the variant's required primitive fields are checked
 *    shallowly (`typeof` / `Array.isArray`), because the projection folds
 *    dereference them unconditionally. Enum-valued strings (`stopReason`,
 *    `decidedBy`, …) are checked as `string` only — a newer version adding an
 *    enum member must not get its events dropped by an older reader.
 *
 * LOCKSTEP — the spec map below is typed so it cannot drift from the union:
 * it is exhaustive over `MoxxyEventType` (adding a variant fails the build
 * until a spec is added) and each spec's keys must be required non-envelope
 * keys of that exact variant (renaming/removing a field fails the build).
 * Listing a field is optional per-variant, so a future required field can be
 * deliberately left unchecked for back-compat (old logs won't have it) — omit
 * with a comment when doing so.
 *
 * PERFORMANCE — this runs once per line while iterating whole logs on the
 * replay hot path. It allocates nothing per call: a handful of `typeof`
 * checks plus an indexed walk over a per-variant spec array precomputed at
 * module load. (This is also why it is hand-rolled rather than zod: a parsed
 * schema library allocates per-line result/issue objects and would
 * deep-validate bulky payloads — attachments, tool outputs — that replay
 * never dereferences structurally.)
 */

import type { EventBase, MoxxyEvent, MoxxyEventOfType, MoxxyEventType } from '@moxxy/sdk';

/** Shallow runtime kinds a required variant field can be checked as. */
type FieldKind = 'string' | 'number' | 'boolean' | 'array' | 'seqRange';

/**
 * Keys of `T` that are required AND carry a checkable type. `undefined
 * extends T[K]` excludes both optional fields and `unknown`-typed ones
 * (`tool_call_requested.input`, `plugin_event.payload`) — the latter on
 * purpose: any JSON value is a valid `unknown`, and `JSON.stringify` drops
 * the key entirely when the value was `undefined` at emit time, so even a
 * presence check would drop legitimate events.
 */
type CheckableKeys<T> = { [K in keyof T]-?: undefined extends T[K] ? never : K }[keyof T];

/**
 * The checkable fields of one variant: required keys that are NOT part of the
 * shared envelope (`EventBase` + the discriminant). Keys are optional so a
 * back-compat omission is possible, but any key listed must exist on the
 * variant — a rename/removal in the sdk union breaks this file's typecheck.
 */
type VariantFieldSpec<T extends MoxxyEventType> = {
  readonly [K in Exclude<
    CheckableKeys<MoxxyEventOfType<T>>,
    keyof EventBase | 'type'
  >]?: FieldKind;
};

/** Exhaustive per-variant field specs — one entry per union member. */
const VARIANT_SPECS: { readonly [T in MoxxyEventType]: VariantFieldSpec<T> } = {
  user_prompt: { text: 'string' },
  assistant_chunk: { delta: 'string' },
  assistant_message: { content: 'string', stopReason: 'string' },
  reasoning_chunk: { delta: 'string' },
  reasoning_message: { content: 'string' },
  tool_call_requested: { callId: 'string', name: 'string' },
  tool_call_approved: { callId: 'string', decidedBy: 'string', mode: 'string' },
  tool_call_denied: { callId: 'string', decidedBy: 'string', reason: 'string' },
  tool_result: { callId: 'string', ok: 'boolean' },
  skill_invoked: { skillId: 'string', name: 'string', reason: 'string' },
  skill_created: {
    skillId: 'string',
    name: 'string',
    path: 'string',
    scope: 'string',
    originatingPrompt: 'string',
  },
  plugin_registered: { pluginId: 'string', name: 'string', version: 'string', kind: 'array' },
  plugin_unregistered: { pluginId: 'string', name: 'string', reason: 'string' },
  mode_iteration: { strategy: 'string', iteration: 'number' },
  compaction: {
    compactor: 'string',
    replacedRange: 'seqRange',
    summary: 'string',
    tokensSaved: 'number',
  },
  elision: {
    elidedThrough: 'number',
    stubbedRanges: 'array',
    elideConversational: 'boolean',
    conversationalRecallThreshold: 'number',
    maxRecallBytes: 'number',
    neverElideTools: 'array',
    tokensSaved: 'number',
  },
  provider_request: { provider: 'string', model: 'string' },
  provider_response: { provider: 'string', model: 'string' },
  error: { kind: 'string', message: 'string' },
  abort: { reason: 'string' },
  plugin_event: { pluginId: 'string', subtype: 'string' },
};

/** Specs flattened to `[key, kind]` arrays ONCE at module load, so the per-line
 *  check walks a plain array by index — no per-call object/iterator work. */
const SPEC_ENTRIES: ReadonlyMap<string, ReadonlyArray<readonly [string, FieldKind]>> = new Map(
  Object.entries(VARIANT_SPECS).map(([type, spec]) => [
    type,
    Object.entries(spec) as ReadonlyArray<readonly [string, FieldKind]>,
  ]),
);

function fieldOk(value: unknown, kind: FieldKind): boolean {
  switch (kind) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      // JSON.parse CAN yield non-finite numbers (`1e999` → Infinity); a
      // non-finite seq-adjacent number poisons every downstream comparison.
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'seqRange':
      // `[from, to]` seq bounds, compared against `event.seq` unconditionally
      // by the projection fold — both must be real numbers.
      return (
        Array.isArray(value) &&
        value.length === 2 &&
        typeof value[0] === 'number' &&
        Number.isFinite(value[0]) &&
        typeof value[1] === 'number' &&
        Number.isFinite(value[1])
      );
  }
}

/**
 * True when `value` (a successfully-parsed JSONL line) is structurally safe to
 * replay as a {@link MoxxyEvent}. See the module doc for what "safe" means —
 * this is a calibrated floor (reject what corrupts replay, keep benign
 * drift), not a proof of full conformance: an unknown newer event type with a
 * valid envelope passes, exactly as it (unvalidated) did before this guard.
 */
export function isMoxxyEventShape(value: unknown): value is MoxxyEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const e = value as Record<string, unknown>;
  // Envelope — strict: replay machinery dereferences these on every event.
  if (typeof e.type !== 'string') return false;
  if (typeof e.id !== 'string') return false;
  if (typeof e.seq !== 'number' || !Number.isFinite(e.seq)) return false;
  if (typeof e.ts !== 'number' || !Number.isFinite(e.ts)) return false;
  // Envelope — lenient-if-present: absent on some legacy logs (sessionId is
  // normalized by `eventForSession`), but a present-with-wrong-type value is
  // junk, not drift.
  if (e.sessionId != null && typeof e.sessionId !== 'string') return false;
  if (e.turnId != null && typeof e.turnId !== 'string') return false;
  if (e.source != null && typeof e.source !== 'string') return false;
  const fields = SPEC_ENTRIES.get(e.type);
  // Unknown (newer) event type with a valid envelope: keep — see module doc.
  if (!fields) return true;
  for (let i = 0; i < fields.length; i += 1) {
    const entry = fields[i]!;
    if (!fieldOk(e[entry[0]], entry[1])) return false;
  }
  return true;
}
