/**
 * Minimal hand-rolled Slack Web API client. The repo norm is hand-rolled
 * `fetch` over a vendor SDK (only Telegram pulls in grammy), so there is NO
 * `@slack/web-api` dependency: each method POSTs JSON to
 * `https://slack.com/api/<method>` with `Authorization: Bearer <token>` and
 * throws on a non-`ok` Slack response.
 */

const SLACK_API_BASE = 'https://slack.com/api';

export interface SlackClientOptions {
  readonly token: string;
  /** Override the API base (tests). */
  readonly baseUrl?: string;
  /** Injectable fetch (tests). Defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

export interface AuthTestResult {
  /** The bot's own user id — used to drop the bot's own messages. */
  readonly botUserId: string;
  readonly teamId?: string;
  readonly team?: string;
  readonly url?: string;
}

export interface PostMessageResult {
  readonly channel: string;
  /** The new message ts — used as the edit target for streaming. */
  readonly ts: string;
}

/** Shape of every Slack API JSON response: a boolean `ok` plus method fields. */
interface SlackApiResponse {
  readonly ok: boolean;
  readonly error?: string;
  readonly [k: string]: unknown;
}

export class SlackClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: SlackClientOptions) {
    this.token = opts.token;
    this.baseUrl = (opts.baseUrl ?? SLACK_API_BASE).replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async call(method: string, body: Record<string, unknown>): Promise<SlackApiResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/${method}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    });
    // Slack always returns 200 with `{ ok: false, error }` for app-level errors;
    // a non-2xx is a transport/auth problem worth surfacing distinctly.
    if (!res.ok) {
      throw new Error(`Slack ${method} HTTP ${res.status}`);
    }
    const json = (await res.json()) as SlackApiResponse;
    if (!json.ok) {
      throw new Error(`Slack ${method} failed: ${json.error ?? 'unknown_error'}`);
    }
    return json;
  }

  /** Validate the token and capture the bot's own user id. */
  async authTest(): Promise<AuthTestResult> {
    const json = await this.call('auth.test', {});
    const botUserId = typeof json['user_id'] === 'string' ? json['user_id'] : '';
    if (!botUserId) throw new Error('Slack auth.test returned no user_id');
    return {
      botUserId,
      ...(typeof json['team_id'] === 'string' ? { teamId: json['team_id'] } : {}),
      ...(typeof json['team'] === 'string' ? { team: json['team'] } : {}),
      ...(typeof json['url'] === 'string' ? { url: json['url'] } : {}),
    };
  }

  /** Post a message into a channel/thread. Returns the channel + new ts. */
  async postMessage(args: {
    channel: string;
    text: string;
    threadTs?: string;
  }): Promise<PostMessageResult> {
    const json = await this.call('chat.postMessage', {
      channel: args.channel,
      text: args.text,
      ...(args.threadTs ? { thread_ts: args.threadTs } : {}),
    });
    const channel = typeof json['channel'] === 'string' ? json['channel'] : args.channel;
    const ts = typeof json['ts'] === 'string' ? json['ts'] : '';
    if (!ts) throw new Error('Slack chat.postMessage returned no ts');
    return { channel, ts };
  }

  /** Edit an existing message (the streaming-update path). */
  async updateMessage(args: { channel: string; ts: string; text: string }): Promise<void> {
    await this.call('chat.update', {
      channel: args.channel,
      ts: args.ts,
      text: args.text,
    });
  }

  /** Optional: read a thread's replies (unused by v1 streaming, exposed for tools). */
  async conversationsReplies(args: {
    channel: string;
    ts: string;
  }): Promise<ReadonlyArray<Record<string, unknown>>> {
    const json = await this.call('conversations.replies', {
      channel: args.channel,
      ts: args.ts,
    });
    const messages = json['messages'];
    return Array.isArray(messages) ? (messages as Array<Record<string, unknown>>) : [];
  }
}
