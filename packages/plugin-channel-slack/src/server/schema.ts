import { z } from '@moxxy/sdk';

/**
 * zod schemas for the Slack Events API request bodies we accept. Every inbound
 * body is validated against these BEFORE any field is read or the session is
 * touched (AGENTS.md A8: validate inbound frames with zod first). Unknown event
 * subtypes parse to the permissive envelope so we never throw on a Slack event
 * type we don't subscribe to — we just ignore it.
 */

/** The URL-verification handshake Slack sends once when you set the Request URL. */
export const urlVerificationSchema = z.object({
  type: z.literal('url_verification'),
  token: z.string().optional(),
  challenge: z.string().min(1),
});
export type SlackUrlVerification = z.infer<typeof urlVerificationSchema>;

/** A `message` or `app_mention` inner event. Loose on the many optional fields. */
export const messageEventSchema = z.object({
  type: z.enum(['message', 'app_mention']),
  /** Author user id. Absent for some bot/system messages. */
  user: z.string().optional(),
  /** Set for messages posted by a bot integration (including our own). */
  bot_id: z.string().optional(),
  /** Message text (may be empty for attachment-only messages). */
  text: z.string().optional(),
  /** Channel the event occurred in. */
  channel: z.string().optional(),
  /** Message timestamp (also the thread root when no `thread_ts`). */
  ts: z.string().optional(),
  /** Present when the message is inside a thread. */
  thread_ts: z.string().optional(),
  /** `message_changed` / `message_deleted` etc. — we ignore edited/system subtypes. */
  subtype: z.string().optional(),
});
export type SlackMessageEvent = z.infer<typeof messageEventSchema>;

/** The `event_callback` envelope wrapping an inner event. */
export const eventCallbackSchema = z.object({
  type: z.literal('event_callback'),
  /** Workspace/team id — the unit we pair against. */
  team_id: z.string().optional(),
  api_app_id: z.string().optional(),
  /** Stable per-event id used for at-least-once dedupe. */
  event_id: z.string().optional(),
  event_time: z.number().optional(),
  /** The actual event. We only act on message/app_mention; others pass through. */
  event: z
    .object({
      type: z.string(),
      user: z.string().optional(),
      bot_id: z.string().optional(),
      text: z.string().optional(),
      channel: z.string().optional(),
      ts: z.string().optional(),
      thread_ts: z.string().optional(),
      subtype: z.string().optional(),
    })
    .passthrough(),
  /** Bot user ids this event was authorized for — lets us detect self-authored messages. */
  authorizations: z
    .array(z.object({ user_id: z.string().optional() }).passthrough())
    .optional(),
});
export type SlackEventCallback = z.infer<typeof eventCallbackSchema>;

/**
 * The top-level Slack request envelope: either the one-off url_verification
 * handshake or an event_callback. A discriminated union on `type` so a body
 * that is neither is rejected with a clear error.
 */
export const slackEnvelopeSchema = z.discriminatedUnion('type', [
  urlVerificationSchema,
  eventCallbackSchema,
]);
export type SlackEnvelope = z.infer<typeof slackEnvelopeSchema>;
