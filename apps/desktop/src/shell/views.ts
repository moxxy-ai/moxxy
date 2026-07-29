/**
 * Top-level destinations. Every one of them is reached from ONE place, the app
 * rail (`AppRail`) — there is no second navigation organ any more, and no view
 * that owns the pane without a corresponding rail item.
 *
 * `chat` is the Runs destination (see the note in AppRail). `automations` holds
 * Workflows / Schedules / Webhooks, which used to be tabs inside Apps; `apps` is
 * now just the app gallery. `channels` absorbed the old standalone `mobile`
 * view, because pairing a phone is one channel among Slack, Telegram and the
 * rest rather than its own top-level place.
 */
export type View =
  | 'chat'
  | 'collaborate'
  | 'automations'
  | 'apps'
  | 'channels'
  | 'settings';
