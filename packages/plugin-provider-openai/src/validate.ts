import OpenAI from 'openai';

export type ValidationResult = { ok: true } | { ok: false; message: string };

export interface ValidateKeyDeps {
  /** Inject the OpenAI SDK constructor for tests. */
  readonly client?: (apiKey: string) => {
    models: { list: () => Promise<unknown> };
  };
  /**
   * Endpoint to probe. Omit for OpenAI itself; pass a vendor base URL to
   * validate an OpenAI-compatible provider (groq, deepseek, openrouter, …)
   * against its own `/v1/models`. Lets `@moxxy/plugin-provider-admin` reuse
   * this validator instead of duplicating the OpenAI-compatible probe.
   */
  readonly baseURL?: string;
}

/**
 * "Is this key accepted by the endpoint?" Lists models — free, no inference
 * cost. Validates OpenAI by default, or an OpenAI-compatible vendor when a
 * `baseURL` is supplied.
 */
export async function validateKey(key: string, deps: ValidateKeyDeps = {}): Promise<ValidationResult> {
  if (!key || key.trim().length < 8) {
    return { ok: false, message: 'key looks too short' };
  }
  const make = deps.client ?? ((k: string) => defaultMaker(k, deps.baseURL));
  try {
    const client = make(key);
    await client.models.list();
    return { ok: true };
  } catch (err) {
    // The raw SDK/network message is untrusted, unbounded text — for a vendor
    // baseURL it surfaces that endpoint's error body straight into the setup
    // UI/logs. Strip URLs and cap the length before returning.
    return { ok: false, message: sanitizeErrorMessage(err) };
  }
}

const MAX_MESSAGE_LENGTH = 200;

function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const stripped = raw
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped) return 'key validation failed';
  return stripped.length > MAX_MESSAGE_LENGTH
    ? `${stripped.slice(0, MAX_MESSAGE_LENGTH)}…`
    : stripped;
}

function defaultMaker(apiKey: string, baseURL?: string): { models: { list: () => Promise<unknown> } } {
  return new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) }) as unknown as {
    models: { list: () => Promise<unknown> };
  };
}
