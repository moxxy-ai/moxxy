/**
 * Secret redaction for anything that leaves the process: an audit record, a
 * terminal prompt, a support paste.
 *
 * Two independent passes, because they catch different things and either alone
 * leaves a real hole:
 *
 *   - by KEY NAME, for `{ apiKey: 'sk-…' }`, where the value is opaque.
 *   - by VALUE SHAPE, for a secret embedded in an ordinary-looking field. The
 *     motivating case is a Bash tool call: its `command` is not a secret-named
 *     key, so a key-name pass alone prints
 *     `curl -H "Authorization: Bearer sk-ant-…"` verbatim.
 *
 * Deliberately NOT a guarantee. A redactor that claims completeness invites
 * treating redacted output as safe to publish; treat it as reducing accidental
 * exposure, not as sanitisation.
 */

/** Field names whose VALUES are secret material regardless of shape. */
const SECRET_KEY =
  /(?:api[_-]?key|secret|token|password|passwd|passphrase|authorization|auth[_-]?token|bearer|credential|private[_-]?key|access[_-]?key)/i;

/**
 * Value shapes that are secrets wherever they appear. Ordered vendor prefixes
 * first (precise, no false positives) then generic bearer/assignment forms.
 *
 * Each pattern keeps any leading context in a capture group so the replacement
 * can preserve it: masking `Authorization: Bearer X` down to just `[redacted]`
 * would lose the fact that a header was there at all, which matters when the
 * point is auditing what was attempted.
 */
const SECRET_VALUE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Vendor-issued key formats.
  [/\b(sk-ant-)[A-Za-z0-9_-]{8,}/g, '$1[redacted]'],
  [/\b(sk-)[A-Za-z0-9_-]{16,}/g, '$1[redacted]'],
  [/\b(gh[pousr]_)[A-Za-z0-9]{16,}/g, '$1[redacted]'],
  [/\b(xox[baprs]-)[A-Za-z0-9-]{8,}/g, '$1[redacted]'],
  [/\b(AKIA)[0-9A-Z]{12,}/g, '$1[redacted]'],
  [/\b(AIza)[A-Za-z0-9_-]{20,}/g, '$1[redacted]'],
  // JWTs: three base64url segments.
  [/\b(ey[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, 'eyJ[redacted-jwt]'],
  // `Authorization: Bearer <anything>` in a header or a shell command.
  [/\b(authorization\s*[:=]\s*(?:bearer|basic|token)\s+)\S+/gi, '$1[redacted]'],
  [/\b(bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1[redacted]'],
  // `FOO_TOKEN=value` / `--api-key value` style assignments.
  [
    /\b([A-Za-z0-9_-]*(?:key|token|secret|password|passwd)[A-Za-z0-9_-]*\s*[:=]\s*)(?!\s)["']?[^\s"'&;|]{6,}["']?/gi,
    '$1[redacted]',
  ],
  // Credentials embedded in a URL.
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@]+(@)/gi, '$1[redacted]$2'],
];

export const REDACTED_PLACEHOLDER = '[redacted]';

/** True when a field name reads as secret-bearing. */
export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

/**
 * Mask secret-shaped substrings inside a free-text value. This is the pass that
 * covers shell commands, URLs, and headers, where the carrier field has an
 * innocuous name.
 */
export function redactSecretText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Redact a structured value: secret-named fields lose their value entirely,
 * every other string is scanned for secret-shaped content.
 *
 * `maxDepth` bounds the walk so a pathologically nested input cannot blow the
 * stack; anything deeper is returned unredacted, which is why callers that
 * accept untrusted shapes should also cap size before display.
 */
export function redactSecrets(value: unknown, maxDepth = 6, depth = 0): unknown {
  if (typeof value === 'string') return redactSecretText(value);
  if (depth >= maxDepth || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, maxDepth, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? REDACTED_PLACEHOLDER : redactSecrets(v, maxDepth, depth + 1);
  }
  return out;
}
