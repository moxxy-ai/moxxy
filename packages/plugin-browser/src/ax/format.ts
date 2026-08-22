import type { AxNode } from './tree.js';

/**
 * Render an accessibility tree as the indented text the model reads.
 *
 * A raw AX tree of a real page runs to thousands of nodes, and the large
 * majority of them carry nothing a model can act on: the internals of icons,
 * unnamed layout wrappers, whole SVG subtrees. Emitting them costs tokens on
 * every single step and buys nothing, so four rules prune them out:
 *
 *   1. depth cap — past {@link MAX_TREE_DEPTH} a subtree collapses to one row
 *      that still reports how much was hidden, so the model can drill in;
 *   2. label truncation at {@link MAX_LABEL_CHARS} — a long paragraph is
 *      recognisable from its opening, and the model can read the full text
 *      with a targeted call;
 *   3. decorative subtrees — the inside of an SVG or of an image is dropped
 *      (the node itself stays, because its name is the meaningful part);
 *   4. wrapper flattening — an unnamed single-child container is not a thing
 *      on the page, it is markup, so it renders as its child.
 *
 * Pure: no browser, no I/O. The saving these rules produce is the difference
 * between a snapshot the loop can afford every step and one it cannot.
 */

/** Rows deeper than this collapse into a single summary row. */
export const MAX_TREE_DEPTH = 8;
/** Accessible names and values are cut to this many characters. */
export const MAX_LABEL_CHARS = 200;

/**
 * Roles that exist for layout only. An unnamed one with a single child is
 * markup rather than content, so it renders as its child (rule 4).
 */
const WRAPPER_ROLES: ReadonlySet<string> = new Set([
  'generic',
  'none',
  'presentation',
  'GenericContainer',
  'Section',
  'group',
  'InlineTextBox',
]);

/** Roles whose children are drawing instructions, never content (rule 3). */
const OPAQUE_ROLES: ReadonlySet<string> = new Set(['SvgRoot', 'graphics-symbol', 'Canvas']);

function clip(text: string): string {
  return text.length <= MAX_LABEL_CHARS ? text : `${text.slice(0, MAX_LABEL_CHARS)}…`;
}

/** Total nodes under `node`, used to report what a collapsed row hides. */
function countDescendants(node: AxNode): number {
  let total = 0;
  const stack = [...node.children];
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next) continue;
    total += 1;
    for (const child of next.children) stack.push(child);
  }
  return total;
}

/** The children this node actually contributes, after rule 3. */
function visibleChildren(node: AxNode): ReadonlyArray<AxNode> {
  if (OPAQUE_ROLES.has(node.role)) return [];
  // An image with a subtree is an icon assembled from parts; its name is the
  // only thing that means anything.
  if (node.role === 'img' && node.children.length > 0) return [];
  return node.children;
}

/** `[uid] role: "name" (value: "…") [focused]` */
function row(node: AxNode, indent: number): string {
  let out = `${'  '.repeat(indent)}[${node.uid}] ${node.role}`;
  if (node.name) out += `: "${clip(node.name)}"`;
  if (node.value) out += ` (value: "${clip(node.value)}")`;
  if (node.focused) out += ' [focused]';
  return out;
}

/**
 * Render `node` and everything under it.
 *
 * `indent` is the visual column and `depth` the budget against
 * {@link MAX_TREE_DEPTH}. They are separate because flattening a wrapper
 * (rule 4) must not consume either — the child takes the wrapper's exact
 * place, so a deeply-nested-but-meaningless chain costs nothing.
 */
export function formatAxTree(node: AxNode, indent = 0, depth = 0): string {
  const children = visibleChildren(node);

  // Rule 4: an unnamed, valueless, single-child wrapper renders as its child.
  if (!node.name && !node.value && children.length === 1 && WRAPPER_ROLES.has(node.role)) {
    return formatAxTree(children[0]!, indent, depth);
  }

  // Rule 1: past the cap, one row that still reports what it hides.
  if (depth >= MAX_TREE_DEPTH) {
    const hidden = countDescendants(node);
    return hidden > 0 ? `${row(node, indent)} ... (${hidden} descendants)` : row(node, indent);
  }

  const lines = [row(node, indent)];
  for (const child of children) lines.push(formatAxTree(child, indent + 1, depth + 1));
  return lines.join('\n');
}
