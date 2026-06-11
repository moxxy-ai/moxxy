/**
 * Collision derived from the ASCII map — never hand-duplicated. Chairs are
 * walkable on purpose: actors path through them and stop on one to sit.
 */

import type { Walkability } from '../sim/types.js';
import { LEGEND_WALKABLE } from './office-map.js';

export function walkableFrom(map: ReadonlyArray<string>): Walkability {
  return map.map((row) => [...row].map((ch) => LEGEND_WALKABLE.has(ch)));
}
