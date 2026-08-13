import type { LLMProvider } from './provider.js';

/**
 * Ask the session's own provider to write a summary of a digest.
 *
 * Shared by every compactor that compresses history with the model rather than
 * by truncation, because the CONTRACT here is subtle enough that a second copy
 * would drift:
 *
 *  - No provider / no model / an empty or failed completion → `null`, so the
 *    caller can degrade to an honest, clearly-labeled truncation.
 *  - A turn CANCELLATION is NOT a failure: it re-throws, because degrading to a
 *    lossy digest would silently rewrite history the user is abandoning. The
 *    signal is checked before the call, on every streamed event, and again in
 *    the catch (a provider that swallows the abort still yields an `error`
 *    event, which is the cancellation when the signal has fired).
 */
export interface ProviderSummaryOptions {
  /** System prompt describing what kind of summary to write. */
  readonly system: string;
  /** Wrap the (possibly truncated) digest into the user message text. */
  readonly prompt: (digest: string) => string;
  /** Hard ceiling on digest chars sent upstream; the middle is dropped. */
  readonly maxInputChars: number;
  /** Output budget for the summary. */
  readonly maxTokens: number;
  readonly provider?: LLMProvider;
  readonly model?: string;
  readonly signal?: AbortSignal;
}

export async function summarizeWithProvider(
  digest: string,
  opts: ProviderSummaryOptions,
): Promise<string | null> {
  const provider = opts.provider;
  if (!provider) return null;
  // Already cancelled before we even start; don't fabricate a fallback digest.
  if (opts.signal?.aborted) throwAbort();
  const model = opts.model ?? provider.models[0]?.id;
  if (!model) return null;
  const input = truncateMiddle(digest, opts.maxInputChars);
  try {
    let out = '';
    for await (const event of provider.stream({
      model,
      system: opts.system,
      messages: [{ role: 'user', content: [{ type: 'text', text: opts.prompt(input) }] }],
      maxTokens: opts.maxTokens,
      ...(opts.signal ? { signal: opts.signal } : {}),
    })) {
      // Stop consuming (and accumulating `out`) the moment the turn is
      // cancelled, even if the provider keeps yielding, so the caller's final
      // abort gate then no-ops rather than rewriting abandoned history.
      if (opts.signal?.aborted) throwAbort();
      if (event.type === 'text_delta') out += event.delta;
      if (event.type === 'error') {
        // An `error` event during an aborted turn is the cancellation, not a
        // transient provider failure, so propagate rather than degrade.
        if (opts.signal?.aborted) throwAbort();
        return null;
      }
    }
    const trimmed = out.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch (err) {
    // Distinguish a user/turn cancellation (re-throw) from a transient provider
    // failure (fall back). Re-throw if the thrown error is an abort OR the
    // signal fired mid-stream.
    if (isAbort(err) || opts.signal?.aborted) throw err instanceof Error ? err : abortError();
    return null;
  }
}

/** Head+tail window of `text`, with the dropped middle called out. */
export function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const half = Math.floor(maxChars / 2);
  return `${text.slice(0, half)}\n[... digest truncated ...]\n${text.slice(-half)}`;
}

export function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

export function abortError(message = 'compaction aborted'): Error {
  const e = new Error(message);
  e.name = 'AbortError';
  return e;
}

function throwAbort(): never {
  throw abortError();
}
