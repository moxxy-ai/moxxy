import Anthropic from '@anthropic-ai/sdk';

export type ValidationResult = { ok: true } | { ok: false; message: string };

export interface ValidateKeyDeps {
  /** Inject the Anthropic SDK constructor for tests. */
  readonly client?: (apiKey: string) => {
    messages: { create: (args: Record<string, unknown>) => Promise<unknown> };
  };
  readonly model?: string;
}

/**
 * "Is this key accepted by Anthropic?" Issues a 1-token completion — effectively
 * free. Returns ok or a useful error message.
 */
export async function validateKey(key: string, deps: ValidateKeyDeps = {}): Promise<ValidationResult> {
  if (!key || key.trim().length < 8) {
    return { ok: false, message: 'key looks too short' };
  }
  const make = deps.client ?? defaultMaker;
  try {
    const client = make(key);
    await client.messages.create({
      model: deps.model ?? 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: friendlyValidationError(err, key) };
  }
}

/**
 * Map a key-validation failure to a fixed friendly string by HTTP status, never
 * echoing raw SDK error text (which can embed request/proxy URLs or header
 * fragments) verbatim. The fallback is truncated and any occurrence of the key
 * is scrubbed so a reflected error can't leak it into setup UIs / logs.
 */
function friendlyValidationError(err: unknown, key: string): string {
  const status = (err as { status?: unknown } | null | undefined)?.status;
  if (typeof status === 'number') {
    if (status === 401) return 'key was rejected';
    if (status === 403) return 'key lacks access';
    if (status === 429) return 'rate limited — try again shortly';
    if (status >= 500) return 'Anthropic returned a server error';
  }
  const raw = err instanceof Error ? err.message : String(err);
  const scrubbed = key ? raw.split(key).join('[redacted]') : raw;
  return scrubbed.length > 200 ? `${scrubbed.slice(0, 200)}…` : scrubbed;
}

function defaultMaker(apiKey: string): { messages: { create: (args: Record<string, unknown>) => Promise<unknown> } } {
  return new Anthropic({ apiKey }) as unknown as {
    messages: { create: (args: Record<string, unknown>) => Promise<unknown> };
  };
}
