/**
 * Single source of truth for "should the TUI animate?". Spinners, the
 * pulsing pending bullet, and the per-second elapsed timers all gate their
 * intervals behind this so motion-sensitive users and piped/CI output get a
 * static frame instead of constant re-render churn.
 *
 * Motion is DISABLED when any of these hold:
 *   - `MOXXY_REDUCED_MOTION` is set to a truthy value (1/true/yes/on)
 *   - `NO_COLOR` is set (the de-facto "minimal/plain output" signal; users
 *     who set it generally also don't want blinking/animation)
 *   - stdout is not a TTY (piped to a file / CI) — animation frames are just
 *     noise and wasted work there
 *
 * Evaluated once at module load: env + TTY-ness don't change mid-process, and
 * a stable value lets components skip their `setInterval` entirely.
 */
function truthyEnv(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

export const MOTION_ENABLED: boolean = (() => {
  if (truthyEnv(process.env.MOXXY_REDUCED_MOTION)) return false;
  // NO_COLOR follows the spec: presence (any value, even empty) disables.
  if (process.env.NO_COLOR != null) return false;
  if (!process.stdout.isTTY) return false;
  return true;
})();
