import type { FilterRule, WebhookFilter } from './store.js';

/**
 * Filter evaluation. Pure function: takes a rule + the request shape,
 * returns whether the rule "fires" (the field matches one of its
 * equals/matches conditions).
 *
 * `equals` is any-of (OR within the rule); `matches` is a single regex.
 * If both are present, either passing the rule is enough.
 *
 * Path lookup is intentionally dumb — dot-separated keys only, no
 * wildcards, no array indexing. The user can put more sophistication
 * in the prompt itself; the filter only decides "should we fire at all".
 */

export interface FilterInput {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: Buffer;
}

function asString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

function readHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const v = headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/**
 * A `JSON.parse(body)` failure is indistinguishable from "valid JSON that is
 * the literal `null`" by the parsed value alone, so we carry an explicit `ok`
 * flag. `ok=false` means the body did not parse — every jsonPath lookup then
 * returns null, exactly as the per-rule parse did.
 */
interface ParsedBody {
  readonly ok: boolean;
  readonly value: unknown;
}

function parseBody(body: Buffer): ParsedBody {
  try {
    return { ok: true, value: JSON.parse(body.toString('utf8')) };
  } catch {
    return { ok: false, value: null };
  }
}

function readJsonPath(parsed: ParsedBody, path: string): string | null {
  if (!parsed.ok) return null;
  let cur: unknown = parsed.value;
  for (const seg of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return asString(cur);
}

function ruleMatches(rule: FilterRule, input: FilterInput, parsed: ParsedBody): boolean {
  const value =
    rule.source === 'header' ? readHeader(input.headers, rule.name) : readJsonPath(parsed, rule.path);
  if (value === null) return false;
  if (rule.equals && rule.equals.includes(value)) return true;
  if (rule.matches) {
    try {
      if (new RegExp(rule.matches).test(value)) return true;
    } catch {
      // Bad regex acts as "no match" — refusing the delivery beats
      // crashing the dispatcher.
      return false;
    }
  }
  return false;
}

export function shouldFire(filter: WebhookFilter, input: FilterInput): boolean {
  // Parse the (up-to-1MB) body ONCE per evaluation and thread it through every
  // rule, instead of re-decoding + re-parsing it per jsonPath rule on the hot
  // pre-ACK delivery path. Result is identical: JSON.parse is deterministic, so
  // one parse threaded everywhere yields the same per-rule lookups as N parses.
  const parsed = parseBody(input.body);
  if (filter.exclude.some((r) => ruleMatches(r, input, parsed))) return false;
  if (filter.include.length === 0) return true;
  return filter.include.some((r) => ruleMatches(r, input, parsed));
}
