import { formatAxTree } from './format.js';
import type { AxNode } from './tree.js';

/**
 * Sending only what moved.
 *
 * The whole tree on every read is what a heavy page costs: ~9,700 tokens for
 * Canva's home page, ~25,300 for a Wikipedia article, and almost all of it
 * identical to the read before — the agent clicked one thing. One task on Canva
 * came to 2.2 million tokens, nearly all of it re-sending a page that had barely
 * changed.
 *
 * This is only possible because a uid now means the same element from one read
 * to the next. With the old document-order counter, inserting one element
 * renumbered everything below it and every line looked new.
 *
 * Built on the rendered text rather than on the tree, so the comparison is over
 * exactly what would have been sent — every pruning rule in `formatAxTree`
 * included, with no second implementation to drift.
 */

/**
 * The rendered rows of an already-rendered tree, keyed by uid.
 *
 * Takes the text rather than the node so a caller that had to render it anyway
 * does not pay for rendering twice — which on a large document is the expensive
 * half of a read.
 */
export function renderingFromText(text: string): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of text.split('\n')) {
    // The uid is the first thing on the row; a name that happens to contain
    // brackets must not be mistaken for one.
    const uid = /^\s*\[(\d+)\]/.exec(line)?.[1];
    if (uid !== undefined) rows.set(uid, line.trim());
  }
  return rows;
}

/** The rendered rows of a tree, keyed by the uid each one carries. */
export function renderingOf(tree: AxNode): Map<string, string> {
  return renderingFromText(formatAxTree(tree));
}

/**
 * What changed between two renderings, as lines the model can read.
 *
 * Keyed by uid, not by position: a row that merely shifted down because
 * something appeared above it has not changed, and reporting it as changed
 * would give back the whole page — which is the thing being avoided.
 *
 * Removals come first, then additions, then edits, so a replacement reads as
 * one event rather than two unrelated ones.
 */
export function diffRendering(before: Map<string, string>, after: Map<string, string>): string[] {
  const removed: string[] = [];
  const added: string[] = [];
  const edited: string[] = [];

  for (const [uid, line] of before) if (!after.has(uid)) removed.push(`- ${line}`);
  for (const [uid, line] of after) {
    const was = before.get(uid);
    if (was === undefined) added.push(`+ ${line}`);
    else if (was !== line) edited.push(`~ ${line}  (was: ${was})`);
  }

  return [...removed, ...added, ...edited];
}
