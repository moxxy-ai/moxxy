/**
 * Slack event idempotency cache. The implementation lives in
 * `@moxxy/channel-kit` (the at-least-once delivery pattern is shared with
 * every inbound-webhook channel and `@moxxy/plugin-webhooks`); re-exported
 * here because it is part of this plugin's public API.
 */
export { DeliveryDedupeCache } from '@moxxy/channel-kit';
