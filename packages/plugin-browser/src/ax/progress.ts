import { row } from './format.js';
import type { AxTree } from './tree.js';

/** Enough to say what is working without listing every spinner on a busy page. */
const MAX_LISTED = 5;

/** The rows of the elements the page says are still working, in no more than a few lines. */
export function workInProgress(tree: AxTree | null): string[] {
  if (!tree) return [];
  const working = [...tree.index.values()].filter((node) => node.inProgress).map((node) => row(node));
  if (working.length <= MAX_LISTED) return working;
  return [...working.slice(0, MAX_LISTED), `… and ${working.length - MAX_LISTED} more`];
}
