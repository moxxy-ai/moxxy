import type { MoxxyConfig } from './schema.js';

/**
 * Deep-merge any number of configs in order. Later wins on scalars; arrays are concatenated;
 * objects are merged key-by-key.
 *
 * Precedence (highest → lowest): CLI flags → project config → user config → defaults.
 */
export function mergeConfigs(...configs: ReadonlyArray<MoxxyConfig | undefined>): MoxxyConfig {
  const out: MoxxyConfig = {};
  for (const cfg of configs) {
    if (!cfg) continue;
    mergeInto(out, cfg);
  }
  return out;
}

// Keys that, when assigned via `target[key] = ...`, hit a prototype setter
// instead of creating an own data property — silently dropping the data AND
// replacing the merged object's prototype. A parsed config (JSON default-export
// or some YAML inputs) can carry an own enumerable `__proto__`/`constructor`/
// `prototype` key, so skip them defensively. Legitimate configs never use them.
const FORBIDDEN_MERGE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function mergeInto(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (FORBIDDEN_MERGE_KEYS.has(key)) continue;
    const existing = target[key];
    if (Array.isArray(value)) {
      target[key] = Array.isArray(existing) ? [...existing, ...value] : [...value];
    } else if (isPlainObject(value)) {
      const base = isPlainObject(existing) ? { ...existing } : {};
      mergeInto(base, value as Record<string, unknown>);
      target[key] = base;
    } else {
      target[key] = value;
    }
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
