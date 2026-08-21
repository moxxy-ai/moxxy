import { buildAxTree, type AxTree } from '../ax/tree.js';
import type { CdpSession } from './types.js';

/**
 * The CDP half of perception: read the accessibility tree, and turn a node
 * handle back into a point on screen.
 *
 * Everything interesting about the tree happens in `../ax/` on plain data.
 * This module is deliberately thin — it exists so the browser-touching part is
 * small enough to read in one screen and the rest can be tested without one.
 */

/** Shape of the box model reply we care about: the content quad, x/y ×4. */
interface BoxModelReply {
  readonly model?: { readonly content?: ReadonlyArray<number> };
}

/**
 * Read the page's accessibility tree.
 *
 * Returns null when the page exposes nothing usable — a blank tab, a document
 * still loading, or a canvas-only app. That is a normal answer, not an error:
 * the caller falls back to a screenshot, which is exactly the ladder both
 * shipping agent browsers use. A CDP *failure* still throws, because a closed
 * target is a different problem and hiding it would strand the turn.
 */
export async function captureAx(cdp: CdpSession): Promise<AxTree | null> {
  await cdp.send('Accessibility.enable');
  const reply = (await cdp.send('Accessibility.getFullAXTree')) as { nodes?: unknown };
  const nodes = reply?.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) return null;
  return buildAxTree(nodes);
}

/**
 * Resolve a backend node id to the point a click should land on.
 *
 * Scrolls first — an element below the fold has a box, but one whose
 * coordinates are outside the viewport, and dispatching a click there hits
 * whatever happens to be on screen instead. Returns null when the node has no
 * usable box: gone from the document, hidden, or collapsed to zero area. A
 * null is an honest "cannot click this", which the caller reports; inventing a
 * point would produce a click on an unrelated element.
 */
export async function pointForBackendNode(
  cdp: CdpSession,
  backendNodeId: number,
): Promise<{ x: number; y: number } | null> {
  try {
    await cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId });
  } catch {
    // Not scrollable (detached, or a document that refuses) — still worth
    // measuring: the node may already be in view.
  }

  let reply: BoxModelReply;
  try {
    reply = (await cdp.send('DOM.getBoxModel', { backendNodeId })) as BoxModelReply;
  } catch {
    return null;
  }

  const quad = reply?.model?.content;
  if (!Array.isArray(quad) || quad.length < 8) return null;

  const xs = [quad[0]!, quad[2]!, quad[4]!, quad[6]!];
  const ys = [quad[1]!, quad[3]!, quad[5]!, quad[7]!];
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);

  // A zero-area box is not clickable.
  if (right - left <= 0 || bottom - top <= 0) return null;

  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}
