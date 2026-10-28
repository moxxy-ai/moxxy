import OpenAI, { APIError } from 'openai';
import { MoxxyError } from '@moxxy/sdk';
import type { GptLiveHistoryItem } from './gpt-live-history.js';

/**
 * GPT-Live over the official OpenAI API (`POST /v1/live/sessions`) on the
 * person's own API key. The key stays with the caller (the desktop's main
 * process); the browser only sends its WebRTC offer and gets the answer back,
 * as OpenAI's WebRTC guide prescribes.
 */
export const GPT_LIVE_MODEL = 'gpt-live-1';
const MAX_SDP_BYTES = 1_000_000;

export interface GptLiveSessionStart {
  /** The browser-created WebRTC offer. */
  readonly sdp: string;
  readonly instructions: string;
  /** Conversation the model should already know when the call opens. */
  readonly history: ReadonlyArray<GptLiveHistoryItem>;
}

export interface GptLiveSessionAnswer {
  readonly sdp: string;
  /** OpenAI's session id (`live_…`), kept opaque. */
  readonly callId: string;
}

export interface GptLiveSessionClientOptions {
  /** The OpenAI API key, read when a call starts; `null` when none is saved. */
  readonly resolveApiKey: () => Promise<string | null>;
  /** OpenAI's API by default; a loopback host in tests. */
  readonly baseURL?: string;
}

/** Negotiates one GPT-Live WebRTC session; audio and events then flow peer-to-peer. */
export class GptLiveSessionClient {
  constructor(private readonly options: GptLiveSessionClientOptions) {}

  async start(input: GptLiveSessionStart): Promise<GptLiveSessionAnswer> {
    assertSdp(input.sdp, 'offer');
    const apiKey = (await this.options.resolveApiKey())?.trim();
    if (!apiKey) {
      throw new MoxxyError({
        code: 'AUTH_NO_CREDENTIALS',
        message: 'GPT-Live needs your OpenAI API key. Add it in Settings → Voice.',
        context: { provider: 'openai' },
      });
    }
    const client = new OpenAI({
      apiKey,
      maxRetries: 0,
      ...(this.options.baseURL ? { baseURL: this.options.baseURL } : {}),
    });
    try {
      const result = await client.live.create({
        session: {
          model: GPT_LIVE_MODEL,
          instructions: input.instructions,
          // `client` delegation keeps every task request on this side, where
          // moxxy runs the user's own words as an agent turn.
          delegation: { type: 'client' },
          ...(input.history.length > 0 ? { input: input.history.map(toInitialItem) } : {}),
        },
        transport: { type: 'webrtc', sdp: input.sdp },
      });
      assertSdp(result.transport.sdp, 'answer');
      return { sdp: result.transport.sdp, callId: result.session.id };
    } catch (error) {
      if (error instanceof APIError) {
        throw new Error(`GPT-Live returned ${error.status ?? 'an error'}: ${error.message}`, { cause: error });
      }
      throw error;
    }
  }
}

function toInitialItem(item: GptLiveHistoryItem) {
  return item.role === 'user'
    ? { type: 'message' as const, role: 'user' as const, content: [{ type: 'input_text' as const, text: item.text }] }
    : { type: 'message' as const, role: 'assistant' as const, content: [{ type: 'output_text' as const, text: item.text }] };
}

function assertSdp(value: string, kind: 'offer' | 'answer'): void {
  if (!value.startsWith('v=0') || Buffer.byteLength(value, 'utf8') > MAX_SDP_BYTES) {
    throw new Error(`Invalid GPT-Live ${kind} SDP`);
  }
}
