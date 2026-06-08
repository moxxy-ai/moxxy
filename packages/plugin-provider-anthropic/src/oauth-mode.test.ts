import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { ProviderEvent } from '@moxxy/sdk';
import { AnthropicProvider } from './provider.js';

/** Build a fake Anthropic SDK client that records `messages.stream` args. */
function fakeClient(events: ReadonlyArray<unknown>): {
  client: Anthropic;
  calls: Array<{ system?: unknown; messages?: unknown }>;
} {
  const calls: Array<{ system?: unknown; messages?: unknown }> = [];
  const client = {
    messages: {
      stream: (args: { system?: unknown; messages?: unknown }) => {
        calls.push(args);
        return (async function* () {
          for (const e of events) yield e;
        })();
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

const DONE_EVENTS = [
  { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
  { type: 'message_stop' },
];

async function drain(it: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('AnthropicProvider OAuth mode', () => {
  it('authenticates with a bearer token and suppresses the api key', () => {
    const p = new AnthropicProvider({ oauthToken: 'tok-123', oauthBeta: ['oauth-2025-04-20'] });
    const client = (p as unknown as { client: { apiKey: unknown; authToken: unknown } }).client;
    // apiKey null => SDK omits x-api-key; authToken => Authorization: Bearer.
    expect(client.apiKey).toBeNull();
    expect(client.authToken).toBe('tok-123');
    expect(p.name).toBe('anthropic');
  });

  it('honours a provider name override', () => {
    const p = new AnthropicProvider({ oauthToken: 't', name: 'claude-code' });
    expect(p.name).toBe('claude-code');
  });

  it('prepends the system preamble as the FIRST system block', async () => {
    const { client, calls } = fakeClient(DONE_EVENTS);
    const p = new AnthropicProvider({
      oauthToken: 'tok',
      systemPreamble: "You are Claude Code, Anthropic's official CLI for Claude.",
      client,
    });
    const out = await drain(
      p.stream({
        model: 'claude-x',
        messages: [
          { role: 'system', content: [{ type: 'text', text: 'REAL SYSTEM' }] },
          { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        ],
      }),
    );

    const sys = calls[0]!.system as Array<{ type: string; text: string }>;
    expect(Array.isArray(sys)).toBe(true);
    expect(sys[0]).toEqual({
      type: 'text',
      text: "You are Claude Code, Anthropic's official CLI for Claude.",
    });
    expect(sys[1]!.text).toBe('REAL SYSTEM');
    expect(out.at(-1)).toMatchObject({ type: 'message_end', stopReason: 'end_turn' });
  });

  it('apiKey mode is unchanged: system stays a bare string', async () => {
    const { client, calls } = fakeClient([{ type: 'message_stop' }]);
    const p = new AnthropicProvider({ apiKey: 'sk-test', client });
    await drain(
      p.stream({
        model: 'm',
        messages: [
          { role: 'system', content: [{ type: 'text', text: 'REAL' }] },
          { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        ],
      }),
    );
    expect(calls[0]!.system).toBe('REAL');
  });
});
