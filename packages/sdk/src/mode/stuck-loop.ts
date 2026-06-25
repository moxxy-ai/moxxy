import { stableHash } from './stable-hash.js';

/**
 * Sliding-window detector for "model keeps making the same tool call".
 *
 * When the same `(toolName, input)` pair appears `repeatThreshold` times in
 * the last `windowSize` calls, the model is almost certainly stuck — polling a
 * tool that returns the same thing, mis-handling an error, etc. Bail early
 * instead of burning through the iteration cap.
 *
 * Shared across every loop strategy so detection is uniform — previously each
 * mode re-rolled this, and one copy used a non-canonical `JSON.stringify`
 * signature that silently missed key-reordered repeats.
 */
export interface StuckSignal {
  /** True when the loop guard should trip. */
  readonly stuck: boolean;
  /** Repeat count behind the trip — for the error message. */
  readonly count: number;
  /**
   * `exact` = the same (tool, full-input) repeated `repeatThreshold` times.
   * `near`  = the same (tool, identity arg — url / file_path / command / …)
   *           repeated `nearThreshold` times while only volatile args (maxBytes,
   *           timeoutMs) varied. Catches the "refetch the same URL with a bigger
   *           maxBytes over and over" loop the exact check sails past.
   */
  readonly kind: 'exact' | 'near';
}

export interface StuckLoopDetector {
  readonly windowSize: number;
  readonly repeatThreshold: number;
  /** Record the call and report whether the loop guard should trip. */
  record(toolName: string, input: unknown): StuckSignal;
}

/**
 * User-tunable loop-guard settings (config `context.loopGuard`). All optional —
 * omitted fields use the defaults below. Set `enabled: false` to turn the guard
 * off entirely and rely solely on the mode's `maxIterations` cap.
 */
export interface LoopGuardSettings {
  readonly enabled?: boolean;
  readonly windowSize?: number;
  readonly repeatThreshold?: number;
  readonly nearWindowSize?: number;
  readonly nearThreshold?: number;
}

/** Default exact-repeat window + trip count. Deliberately generous: the
 *  `maxIterations` cap (500 in default mode) is the real runaway backstop, so
 *  this only needs to catch a *tight* same-call loop, not legitimately repeated
 *  work (re-reading a file, re-running `git status` across steps, a couple of
 *  retries). Tunable via `context.loopGuard`. */
export const DEFAULT_LOOP_WINDOW_SIZE = 12;
export const DEFAULT_LOOP_REPEAT_THRESHOLD = 8;

/** Identity arguments that pin "the same target" across volatile-arg variation,
 *  best-first. The first present string field wins. */
const IDENTITY_ARG_KEYS = ['url', 'file_path', 'path', 'command', 'cmd', 'query', 'pattern'];

function identityArg(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  for (const k of IDENTITY_ARG_KEYS) {
    const v = o[k];
    if (typeof v === 'string' && v.trim().length > 0) return `${k}=${v}`;
  }
  return null;
}

export function createStuckLoopDetector(opts: LoopGuardSettings = {}): StuckLoopDetector {
  const enabled = opts.enabled ?? true;
  const windowSize = opts.windowSize ?? DEFAULT_LOOP_WINDOW_SIZE;
  const repeatThreshold = opts.repeatThreshold ?? DEFAULT_LOOP_REPEAT_THRESHOLD;
  // Near-dups need a higher count + a wider window (they're spread out across a
  // burst of other calls), and tolerate a couple of legit "bigger refetch" tries.
  const nearWindowSize = opts.nearWindowSize ?? Math.max(windowSize * 2, 24);
  const nearThreshold = opts.nearThreshold ?? Math.max(repeatThreshold + 2, 5);
  const recent: string[] = [];
  const recentNear: string[] = [];
  return {
    windowSize,
    repeatThreshold,
    record(toolName, input): StuckSignal {
      // Disabled → never trip (rely on the maxIterations cap alone).
      if (!enabled) return { stuck: false, count: 0, kind: 'exact' };
      const key = `${toolName}|${stableHash(input)}`;
      recent.push(key);
      if (recent.length > windowSize) recent.shift();
      const exactCount = recent.filter((k) => k === key).length;
      if (exactCount >= repeatThreshold) return { stuck: true, count: exactCount, kind: 'exact' };

      let nearCount = 0;
      const id = identityArg(input);
      if (id !== null) {
        const nearKey = `${toolName}|${id}`;
        recentNear.push(nearKey);
        if (recentNear.length > nearWindowSize) recentNear.shift();
        nearCount = recentNear.filter((k) => k === nearKey).length;
        if (nearCount >= nearThreshold) return { stuck: true, count: nearCount, kind: 'near' };
      }
      return { stuck: false, count: Math.max(exactCount, nearCount), kind: 'exact' };
    },
  };
}
