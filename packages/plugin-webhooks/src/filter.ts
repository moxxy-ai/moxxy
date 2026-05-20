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

function readJsonPath(body: Buffer, path: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    return null;
  }
  let cur: unknown = parsed;
  for (const seg of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return asString(cur);
}

function ruleMatches(rule: FilterRule, input: FilterInput): boolean {
  const value =
    rule.source === 'header' ? readHeader(input.headers, rule.name) : readJsonPath(input.body, rule.path);
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
  if (filter.exclude.some((r) => ruleMatches(r, input))) return false;
  if (filter.include.length === 0) return true;
  return filter.include.some((r) => ruleMatches(r, input));
}
