/**
 * Lightweight "is this API key actually accepted by the provider" checks. Used
 * by the setup wizard to give users immediate feedback during key entry.
 *
 * Costs:
 *   - openai: free (lists model metadata; no inference)
 *   - anthropic: ~one input token; effectively free
 */

export type ValidationResult = { ok: true } | { ok: false; message: string };

export interface ValidateKeyDeps {
  /** Inject SDK constructors for tests. Defaults to the real packages. */
  readonly makeAnthropic?: (apiKey: string) => {
    messages: { create: (args: Record<string, unknown>) => Promise<unknown> };
  };
  readonly makeOpenAI?: (apiKey: string) => {
    models: { list: () => Promise<unknown> };
  };
}

export async function validateProviderKey(
  providerId: string,
  key: string,
  deps: ValidateKeyDeps = {},
): Promise<ValidationResult> {
  if (!key || key.trim().length < 8) {
    return { ok: false, message: 'key looks too short' };
  }
  try {
    if (providerId === 'anthropic') {
      const make = deps.makeAnthropic ?? (await defaultAnthropicFactory());
      const client = make(key);
      await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return { ok: true };
    }
    if (providerId === 'openai') {
      const make = deps.makeOpenAI ?? (await defaultOpenAIFactory());
      const client = make(key);
      await client.models.list();
      return { ok: true };
    }
    return { ok: false, message: `unknown provider: ${providerId}` };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function defaultAnthropicFactory(): Promise<NonNullable<ValidateKeyDeps['makeAnthropic']>> {
  const mod: unknown = await import('@anthropic-ai/sdk');
  const Ctor = (mod as { default: new (opts: { apiKey: string }) => unknown }).default;
  return (apiKey: string) =>
    new Ctor({ apiKey }) as unknown as ReturnType<NonNullable<ValidateKeyDeps['makeAnthropic']>>;
}

async function defaultOpenAIFactory(): Promise<NonNullable<ValidateKeyDeps['makeOpenAI']>> {
  const mod: unknown = await import('openai');
  const Ctor = (mod as { default: new (opts: { apiKey: string }) => unknown }).default;
  return (apiKey: string) =>
    new Ctor({ apiKey }) as unknown as ReturnType<NonNullable<ValidateKeyDeps['makeOpenAI']>>;
}
