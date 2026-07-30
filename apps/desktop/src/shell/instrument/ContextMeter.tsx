/**
 * The context-window gauge, drawn as discrete segments rather than a continuous
 * bar.
 *
 * A smooth bar answers "roughly how full", which is the wrong question during a
 * long run: what a supervisor needs is "how many turns do I have left before
 * this compacts". Ticks are countable, so the same glance gives a magnitude —
 * and the gauge changes hue at the two thresholds that actually matter rather
 * than ramping continuously through colours that mean nothing in between.
 */

/** Segments in the gauge. Twelve reads as countable at 5px each without turning
 *  the instrument bar into a ruler. */
const SEGMENTS = 12;

/** Above this the window is filling faster than it is being reclaimed and a
 *  compaction is worth thinking about. */
const CAUTION_AT = 0.7;
/** Above this a compaction is imminent whether or not you ask for one. */
const CRITICAL_AT = 0.9;

export type ContextLevel = 'nominal' | 'caution' | 'critical';

export function contextLevel(fraction: number): ContextLevel {
  if (fraction >= CRITICAL_AT) return 'critical';
  if (fraction >= CAUTION_AT) return 'caution';
  return 'nominal';
}

export function ContextMeter({ fraction }: { readonly fraction: number }): JSX.Element {
  const f = Math.max(0, Math.min(1, fraction));
  const level = contextLevel(f);
  // Round UP so any non-zero usage lights at least one segment: a gauge that
  // reads empty while the window is filling is worse than no gauge.
  const lit = f === 0 ? 0 : Math.max(1, Math.ceil(f * SEGMENTS));
  return (
    <span
      className="meter"
      data-level={level}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(f * 100)}
      aria-label={`Context window ${Math.round(f * 100)}% used`}
    >
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <i key={i} data-on={i < lit ? '' : undefined} />
      ))}
    </span>
  );
}
