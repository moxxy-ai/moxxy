/**
 * Top-level destinations. Every one of them is reached from ONE place, the app
 * rail (`AppRail`) — there is no second navigation organ any more, and no view
 * that owns the pane without a corresponding rail item.
 *
 * `chat` is the Runs destination (see the note in AppRail). `automations` holds
 * Workflows / Schedules / Webhooks, which used to be tabs inside Apps; `apps` is
 * now just the app gallery.
 *
 * `channels` is the CATALOG — one page per channel, picked in the index column.
 * `mobile` sits apart from it, at the foot of the rail beside Settings: pairing
 * this machine with a phone is a property of the INSTALL, not another chat
 * surface to configure, and it has no catalog entry, no dedicated runner and no
 * secrets of its own.
 */
export type View =
  | 'chat'
  | 'extensions'
  | 'collaborate'
  | 'automations'
  | 'apps'
  | 'channels'
  | 'mobile'
  | 'settings';
