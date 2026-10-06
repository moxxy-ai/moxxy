import { randomUUID } from 'node:crypto';
import { ORIGINATOR } from '../oauth.js';
import type { GptLiveHistoryItem } from './gpt-live-history.js';

/**
 * GPT-Live over the user's existing ChatGPT OAuth login.
 *
 * The public `/v1/live/sessions` API requires a platform API key; a ChatGPT
 * subscription reaches GPT-Live only through the Codex realtime route below —
 * the same one the open-source Codex app-server uses. It is an undocumented
 * preview contract, so every wire detail lives in this one module.
 */
export const DEFAULT_GPT_LIVE_BASE_URL = 'https://chatgpt.com/backend-api';
export const GPT_LIVE_MODEL = 'gpt-live-1-codex';
export const GPT_LIVE_DEFAULT_VOICE = 'maple';
const GPT_LIVE_PROTOCOL = 'quicksilver=v2';
const CALLS_PATH = '/codex/realtime/calls';
const CALLS_QUERY = '?intent=quicksilver&architecture=avas';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_SDP_BYTES = 1_000_000;
const MAX_ERROR_CHARS = 2_048;
const CALL_ID = /^(rtc_[A-Za-z0-9_-]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export interface GptLiveCredentials {
  readonly accessToken: string;
  readonly accountId?: string;
}

export interface GptLiveCallStart {
  /** The browser-created WebRTC offer. */
  readonly sdp: string;
  readonly instructions: string;
  /** Conversation the model should already know when the call opens. */
  readonly history: ReadonlyArray<GptLiveHistoryItem>;
  readonly voice?: string;
}

export interface GptLiveCallAnswer {
  readonly sdp: string;
  readonly callId: string;
}

export interface GptLiveCallClientOptions {
  readonly resolveCredentials: () => Promise<GptLiveCredentials>;
  /** `https://chatgpt.com/backend-api`, or a loopback host for tests. */
  readonly baseUrl?: string;
  readonly sessionIdProvider?: () => string;
  readonly timeoutMs?: number;
}

/** Negotiates one GPT-Live WebRTC call; audio and events then flow peer-to-peer. */
export class GptLiveCallClient {
  private readonly resolveCredentials: () => Promise<GptLiveCredentials>;
  private readonly callsUrl: string;
  private readonly sessionIdProvider: () => string;
  private readonly timeoutMs: number;

  constructor(options: GptLiveCallClientOptions) {
    this.resolveCredentials = options.resolveCredentials;
    this.callsUrl = buildGptLiveCallsUrl(options.baseUrl);
    this.sessionIdProvider = options.sessionIdProvider ?? randomUUID;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async start(input: GptLiveCallStart): Promise<GptLiveCallAnswer> {
    assertSdp(input.sdp, 'offer');
    const credentials = await this.resolveCredentials();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/sdp',
      Authorization: `Bearer ${credentials.accessToken}`,
      originator: ORIGINATOR,
      'openai-alpha': GPT_LIVE_PROTOCOL,
      'x-session-id': this.sessionIdProvider(),
    };
    if (credentials.accountId) headers['ChatGPT-Account-Id'] = credentials.accountId;

    const response = await fetch(this.callsUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sdp: input.sdp, session: buildGptLiveSession(input) }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `GPT-Live returned ${response.status}: ${body.slice(0, MAX_ERROR_CHARS) || response.statusText}`,
      );
    }
    assertSdp(body, 'answer');
    return { sdp: body, callId: parseCallId(response.headers.get('location')) };
  }
}

function buildGptLiveSession(input: GptLiveCallStart): Record<string, unknown> {
  const session: Record<string, unknown> = {
    instructions: input.instructions,
    model: GPT_LIVE_MODEL,
    audio: { output: { voice: input.voice ?? GPT_LIVE_DEFAULT_VOICE } },
    // `client` delegation keeps every task request on this side, where moxxy
    // runs the user's own words as an agent turn rather than letting a backend
    // model act on its paraphrase.
    delegation: { type: 'client' },
  };
  if (input.history.length > 0) {
    session.initial_items = input.history.map((item) => ({
      type: 'message',
      role: item.role,
      content: [{ type: item.role === 'user' ? 'input_text' : 'output_text', text: item.text }],
    }));
  }
  return session;
}

/**
 * The call carries a live bearer token, so a configurable base URL may only
 * point at https://chatgpt.com or a loopback host (the local test seam).
 */
export function buildGptLiveCallsUrl(baseUrl = DEFAULT_GPT_LIVE_BASE_URL): string {
  const url = new URL(baseUrl);
  const httpsChatgpt = url.protocol === 'https:' && url.hostname === 'chatgpt.com';
  if (!httpsChatgpt && !isLoopbackHostname(url.hostname)) {
    throw new Error(
      `Refusing to send ChatGPT OAuth credentials to ${url.origin}; GPT-Live must use https://chatgpt.com.`,
    );
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}${CALLS_PATH}${CALLS_QUERY}`;
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function assertSdp(value: string, kind: 'offer' | 'answer'): void {
  if (!value.startsWith('v=0') || Buffer.byteLength(value, 'utf8') > MAX_SDP_BYTES) {
    throw new Error(`Invalid GPT-Live ${kind} SDP`);
  }
}

function parseCallId(location: string | null): string {
  const path = location ? location.split('?', 1).join('') : '';
  const segment = path.split('/').filter(Boolean).at(-1);
  if (!segment || !CALL_ID.test(segment)) {
    throw new Error('GPT-Live answer is missing a valid Location header');
  }
  return segment;
}
