/**
 * Shared secret-redaction for any surface that echoes raw tool inputs to the
 * terminal (permission prompt, subagent activity panel). Tool inputs can carry
 * API keys / tokens / vault-resolved values; a length cap is NOT redaction.
 * This masks the VALUES of secret-named fields before they ever reach the
 * scrollback (or terminal logging).
 *
 * Single source of truth so the permission dialog and the agents panel can't
 * drift — one redact one display path, leave the other leaking.
 */

/** Field names whose VALUES are likely secret material and must never be
 *  echoed verbatim. */
const SECRET_KEY =
  /(?:api[_-]?key|secret|token|password|passwd|passphrase|authorization|auth[_-]?token|bearer|credential|private[_-]?key|access[_-]?key)/i;

const REDACTED = '[redacted]';

/**
 * Shallow-redact secret-named fields in a tool-input value before display.
 * Best-effort and bounded: only the top three object levels are walked so a
 * pathologically deep input can't blow the stack — anything deeper is returned
 * as-is (the depth cap is below the typical tool-arg shape, so real secrets at
 * sane depths are still masked).
 */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 2 || value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? REDACTED : redactSecrets(v, depth + 1);
  }
  return out;
}

/** True when a field name reads as secret-bearing. Lets callers that format
 *  per-field (rather than stringifying the whole object) redact a single
 *  value without rebuilding the object. */
export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

export const REDACTED_PLACEHOLDER = REDACTED;
