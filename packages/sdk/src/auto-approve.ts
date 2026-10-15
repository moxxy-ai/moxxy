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
/**
 * An agent connection undid a change made outside Moxxy that let the agent act
 * without asking: a note for the person, not a switch (the state stays as it was).
 */
export const AUTO_APPROVE_RESTORED_SUBTYPE = 'auto_approve_restored';

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

/** Whether the conversation recorded any switch (the person's, or the agent's own setup Moxxy took on): until then its agent's own setup shows. */
export function autoApproveRecorded(events: ReadonlyArray<MoxxyEvent>): boolean {
  return events.some((event) => autoApproveSwitch(event) !== null);
}

/** Whether the switch in force is the agent's own setup Moxxy took on (recorded by the system), not the person's choice. */
export function autoApproveFromAgent(events: ReadonlyArray<MoxxyEvent>): boolean {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event && autoApproveSwitch(event) !== null) return event.source !== 'user';
  }
  return false;
}
