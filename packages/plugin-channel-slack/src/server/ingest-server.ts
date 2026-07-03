import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  DeliveryDedupeCache,
  IngestHttpServer,
  respondJson,
  type IngestHttpServerHandle,
} from '@moxxy/channel-kit';
import { slackEnvelopeSchema, type SlackEventCallback } from './schema.js';
import { verifySlackSignature } from './verify.js';

/**
 * The HTTP front-end for the Slack channel. Binds a `node:http` server to an
 * ephemeral loopback port; the channel exposes it publicly via the proxy
 * tunnel. Slack POSTs every event to `<public>/slack/events`.
 *
 * The transport scaffold (routing, health probe, size-capped raw-body read,
 * verify gate, catch-all error handling) is `@moxxy/channel-kit`'s
 * {@link IngestHttpServer}; Slack's HMAC scheme stays HERE as its verify hook,
 * and this module owns everything after verification.
 *
 * Handler order — every gate runs BEFORE the session is touched (skill A8/A46):
 *   1. POST-only (+ a GET `/slack/health` liveness probe).       [kit]
 *   2. read the RAW body bytes (size cap) — required for the HMAC. [kit]
 *   3. signature gate → 401 (verify over the raw bytes, before JSON.parse).
 *   4. zod-validate the envelope → 400.
 *   5. `url_verification` → echo `{ challenge }` (the handshake).
 *   6. dedupe — drop on `X-Slack-Retry-Num` or a seen `event_id`.
 *   7. drop the bot's own messages (`event.user === botUserId` / `event.bot_id`).
 *   8. pairing gate — ignore unless the team/channel is authorized.
 *   9. ACK 200 synchronously, THEN run the turn fire-and-forget (Slack's 3s
 *      ack budget; never run `runTurn` on the request path).
 *
 * Every handler error is caught so a bad request can never escalate to a
 * process-level uncaughtException.
 */

const EVENTS_PATH = '/slack/events';
const HEALTH_PATH = '/slack/health';

/** Decision the channel makes about an inbound event. */
export interface DispatchContext {
  readonly teamId: string | undefined;
  readonly channel: string;
  readonly text: string;
  readonly user: string | undefined;
  readonly threadTs: string;
  readonly eventType: string;
}

export interface IngestServerHooks {
  /** The bot's own user id, captured at start via `auth.test` (drop self-messages). */
  readonly botUserId: string;
  /** Is this team/channel authorized to drive the session? (pairing gate) */
  isAuthorized(teamId: string | undefined, channel: string | undefined): boolean;
  /**
   * Observe a verified inbound event from a (possibly unauthorized) team/channel.
   * Used by the TOFU `pair` flow to capture the first event and persist it.
   * Returns true if the event was consumed by pairing (so it should NOT also
   * drive a turn).
   */
  onVerifiedEvent?(ev: SlackEventCallback): boolean | Promise<boolean>;
  /** Run a turn for an authorized, deduped, non-self event (fire-and-forget). */
  dispatch(ctx: DispatchContext): void;
}

export interface IngestServerOptions {
  readonly host?: string;
  readonly signingSecret: string;
  readonly hooks: IngestServerHooks;
  /** Max request body size in bytes. Default 1MB. */
  readonly maxBodyBytes?: number;
  /** Override dedupe cache (tests). */
  readonly dedupe?: DeliveryDedupeCache;
  readonly logger?: {
    info?(msg: string, meta?: Record<string, unknown>): void;
    warn?(msg: string, meta?: Record<string, unknown>): void;
  };
}

export type IngestServerHandle = IngestHttpServerHandle;

export class IngestServer {
  private readonly inner: IngestHttpServer;
  private readonly dedupe: DeliveryDedupeCache;

  constructor(private readonly opts: IngestServerOptions) {
    this.dedupe = opts.dedupe ?? new DeliveryDedupeCache();
    this.inner = new IngestHttpServer({
      ...(opts.host ? { host: opts.host } : {}),
      eventsPath: EVENTS_PATH,
      healthPath: HEALTH_PATH,
      healthBody: () => ({ status: 'ok', listener: 'slack' }),
      ...(opts.maxBodyBytes !== undefined ? { maxBodyBytes: opts.maxBodyBytes } : {}),
      label: 'slack',
      verify: ({ rawBody, headers }) =>
        verifySlackSignature({ rawBody, headers, signingSecret: opts.signingSecret }),
      handleVerified: (raw, req, res) => this.handleVerified(raw, req, res),
      ...(opts.logger ? { logger: opts.logger } : {}),
    });
  }

  get port(): number {
    return this.inner.port;
  }

  /** Bind on an ephemeral loopback port. Resolves once listening. */
  start(): Promise<IngestServerHandle> {
    return this.inner.start();
  }

  stop(): Promise<void> {
    return this.inner.stop();
  }

  /** Steps 4–9: everything after the raw-body + signature gates. */
  private async handleVerified(
    raw: Buffer,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    // 4) zod-validate the envelope.
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw.toString('utf8'));
    } catch {
      respondJson(res, 400, { error: 'invalid_json' });
      return;
    }
    const parsed = slackEnvelopeSchema.safeParse(parsedJson);
    if (!parsed.success) {
      this.opts.logger?.warn?.('slack: malformed envelope', {
        issue: parsed.error.issues[0]?.message,
      });
      respondJson(res, 400, { error: 'bad_request' });
      return;
    }
    const envelope = parsed.data;

    // 5) url_verification handshake.
    if (envelope.type === 'url_verification') {
      respondJson(res, 200, { challenge: envelope.challenge });
      return;
    }

    // From here on it's an event_callback. ACK fast; do everything else after
    // (or fire-and-forget) so we stay inside Slack's 3-second ack budget.
    const callback = envelope;

    // 6) Dedupe — drop retries / repeated event ids. We record the id only for
    // verified events so an unverified request can never poison the cache.
    const isRetry = req.headers['x-slack-retry-num'] !== undefined;
    const eventId = callback.event_id;
    const dupe = isRetry || (eventId ? !this.dedupe.check(eventId) : false);

    // 7) Self-message guard: never re-trigger on our own posts.
    const ev = callback.event;
    const isSelf =
      ev.bot_id !== undefined ||
      (ev.user !== undefined && ev.user === this.opts.hooks.botUserId);

    // ACK synchronously BEFORE running anything.
    respondJson(res, 200, { status: 'ok' });

    if (dupe || isSelf) return;

    // Pairing TOFU hook gets first crack at a verified event (even unauthorized),
    // so it can capture + persist the first team/channel.
    try {
      const consumed = (await this.opts.hooks.onVerifiedEvent?.(callback)) ?? false;
      if (consumed) return;
    } catch (err) {
      this.opts.logger?.warn?.('slack: pairing hook threw', { err: String(err) });
    }

    // 8) Pairing gate — only authorized team/channel drives the session.
    if (!this.opts.hooks.isAuthorized(callback.team_id, ev.channel)) {
      this.opts.logger?.info?.('slack: dropped event from unauthorized team/channel', {
        team: callback.team_id,
        channel: ev.channel,
      });
      return;
    }

    // Only act on message-ish events (we subscribe to app_mention primarily;
    // message events with an edit/system subtype are ignored).
    const eventType = ev.type;
    if (eventType !== 'app_mention' && eventType !== 'message') return;
    if (ev.subtype) return; // message_changed / message_deleted / channel_join …
    const channel = ev.channel;
    const text = (ev.text ?? '').trim();
    if (!channel || !text) return;

    // 9) Run the turn fire-and-forget (already ACKed).
    this.opts.hooks.dispatch({
      teamId: callback.team_id,
      channel,
      text,
      user: ev.user,
      threadTs: ev.thread_ts ?? ev.ts ?? channel,
      eventType,
    });
  }
}

export { EVENTS_PATH as SLACK_EVENTS_PATH };
