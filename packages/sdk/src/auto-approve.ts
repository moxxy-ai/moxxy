import type { MoxxyEvent } from './events.js';
import { asPluginId } from './ids.js';

/**
 * Auto-approve belongs to the conversation, not to one client: a switch is
 * recorded in the event log as a `plugin_event`, so the desktop, the TUI and a
 * channel bot attached to the same session all see one state, and the state
 * is a pure fold over the log (a reset log starts with it off).
 */
export const AUTO_APPROVE_PLUGIN_ID = asPluginId('@moxxy/auto-approve');
export const AUTO_APPROVE_SUBTYPE = 'auto_approve';

/** The on/off an event records, or null when it isn't an auto-approve switch. */
export function autoApproveSwitch(event: MoxxyEvent): boolean | null {
  if (event.type !== 'plugin_event') return null;
  if (event.pluginId !== AUTO_APPROVE_PLUGIN_ID || event.subtype !== AUTO_APPROVE_SUBTYPE) return null;
  const enabled = (event.payload as { enabled?: unknown } | null)?.enabled;
  return typeof enabled === 'boolean' ? enabled : null;
}

/** A conversation's auto-approve state: the last recorded switch wins; off until one is recorded. */
export function autoApproveFromEvents(events: ReadonlyArray<MoxxyEvent>): boolean {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    const enabled = event ? autoApproveSwitch(event) : null;
    if (enabled !== null) return enabled;
  }
  return false;
}
