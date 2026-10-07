/**
 * The views that can own the pane. Each one is listed once in
 * `navigation/destinations.ts`, which is what the account menu, the command
 * palette and the shortcuts read; no view is reachable from anywhere else.
 *
 * `chat` is the Runs view. `automations` holds Workflows / Schedules / Webhooks;
 * `apps` is the app gallery.
 *
 * `channels` is the catalog, one page per channel. `mobile` sits apart from it:
 * pairing this machine with a phone is a property of the install, not another
 * chat surface to configure, and it has no catalog entry, no dedicated runner
 * and no secrets of its own.
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
