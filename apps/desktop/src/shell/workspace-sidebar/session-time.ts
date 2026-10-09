const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const DATE = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });

/**
 * When a run was last touched, the way a messenger says it. Null when the
 * session carries no usable time: a missing reading is better than a made-up one.
 */
export function formatSessionTime(lastActivity: string | undefined, now: number): string | null {
  if (!lastActivity) return null;
  const at = Date.parse(lastActivity);
  if (Number.isNaN(at)) return null;
  const elapsed = now - at;
  if (elapsed < MINUTE) return 'now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d`;
  return DATE.format(at);
}
