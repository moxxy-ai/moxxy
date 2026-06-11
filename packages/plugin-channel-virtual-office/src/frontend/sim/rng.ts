/**
 * Tiny deterministic PRNG for the simulation. Everything random in `sim/`
 * flows through an {@link Rng} so tests can seed (or stub) it.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  pick<T>(arr: ReadonlyArray<T>): T;
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
}

/** Classic mulberry32 — small, fast, good-enough distribution for ambience. */
export function mulberry32(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (maxExclusive: number): number => Math.floor(next() * maxExclusive),
    pick: <T>(arr: ReadonlyArray<T>): T => arr[Math.floor(next() * arr.length)],
  };
}
