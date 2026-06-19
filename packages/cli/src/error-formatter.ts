/**
 * Format a top-level error for display to the user. Knows about:
 *   - `MoxxyError` (code + message + hint + context)
 *   - `VaultPassphraseError` (already-friendly multi-line message)
 *   - Anything else → falls back to a single `fatal:` line
 *
 * Set `MOXXY_DEBUG=1` to also dump `context` and the underlying `cause`
 * chain — useful when a hint isn't enough and we need to inspect the
 * provider/network details.
 */

import { MoxxyError } from '@moxxy/sdk';
import { colors } from './colors.js';

export interface FormatErrorOptions {
  readonly debug?: boolean;
}

export function formatErrorForCli(err: unknown, opts: FormatErrorOptions = {}): string {
  // Vault passphrase keeps its bespoke multi-line message — every line of
  // recovery instructions already sits inside `.message`.
  if (err && (err as { name?: unknown }).name === 'VaultPassphraseError') {
    return colors.red((err as Error).message);
  }

  if (MoxxyError.isMoxxyError(err)) {
    return formatMoxxyError(err, opts);
  }

  const message = err instanceof Error ? err.message : String(err);
  const lines = [colors.red('error: ') + message];
  if (opts.debug && err instanceof Error && err.stack) {
    lines.push(colors.dim(err.stack));
  }
  return lines.join('\n');
}

function formatMoxxyError(err: MoxxyError, opts: FormatErrorOptions): string {
  const header = `${colors.red('error')} ${colors.dim(`[${err.code}]`)}  ${err.message}`;
  const lines: string[] = [header];
  if (err.hint) {
    lines.push(`${colors.dim('hint:')} ${err.hint}`);
  }
  if (opts.debug) {
    if (err.context) {
      const ctx = Object.entries(err.context)
        .map(([k, v]) => `${k}=${redactContextValue(k, v)}`)
        .join(' ');
      if (ctx) lines.push(colors.dim(`context: ${ctx}`));
    }
    const causeChain = describeCauseChain(err);
    if (causeChain) lines.push(colors.dim(causeChain));
  }
  return lines.join('\n');
}

/** Context keys whose value is almost certainly a secret — never echo it, even
 *  under MOXXY_DEBUG, since the shared error sink carries provider/network
 *  errors that may stuff tokens into context. */
const SENSITIVE_KEY = /(?:^|[._-])(?:api[_-]?key|token|authorization|auth|password|passphrase|secret|cookie|session|credential)s?(?:$|[._-])/i;

/** Cap a single context/cause string so a huge body can't flood stderr/logs. */
const MAX_DEBUG_VALUE_LEN = 500;

function redactContextValue(key: string, value: unknown): string {
  if (SENSITIVE_KEY.test(key)) return '[redacted]';
  return truncate(String(value));
}

function truncate(s: string): string {
  return s.length > MAX_DEBUG_VALUE_LEN ? `${s.slice(0, MAX_DEBUG_VALUE_LEN)}… (${s.length} chars)` : s;
}

function describeCauseChain(err: Error): string {
  const chain: string[] = [];
  let cur: unknown = (err as { cause?: unknown }).cause;
  let depth = 0;
  while (cur && depth < 5) {
    const raw = cur instanceof Error ? `${cur.name}: ${cur.message}` : String(cur);
    chain.push(`  caused by ${truncate(raw)}`);
    cur = (cur as { cause?: unknown }).cause;
    depth += 1;
  }
  return chain.join('\n');
}
