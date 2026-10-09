/**
 * Build a compact, uid-indexed accessibility tree from a raw CDP
 * `Accessibility.getFullAXTree` payload.
 *
 * This is the model's primary view of a page: role + accessible name + a
 * stable handle, instead of a screenshot it has to guess coordinates from.
 * The uid is OURS (a walk counter), not CDP's `nodeId` — CDP ids are not
 * stable across documents and mean nothing to the model, while a small
 * integer is cheap to emit and cheap to read back.
 *
 * Pure and browser-free on purpose: the whole valuable part of the perception
 * layer is testable on a saved payload, and only the transport needs a real
 * page. See `./format.ts` for turning the result into model-facing text.
 */

/** One node of a CDP `Accessibility.getFullAXTree` reply, loosely typed
 *  because `playwright` is an optional peer dependency. */
export interface AxNodeRaw {
  readonly nodeId: string;
  readonly ignored?: boolean;
  readonly role?: { value?: unknown };
  readonly name?: { value?: unknown };
  readonly value?: { value?: unknown };
  readonly description?: { value?: unknown };
  readonly childIds?: ReadonlyArray<string>;
  readonly backendDOMNodeId?: number;
  readonly properties?: ReadonlyArray<{ name?: string; value?: { value?: unknown } }>;
  /** Set on nodes read from a frame's own session (a frame from another site); not CDP's. */
  readonly frame?: string;
}

/** What the page says an element is in, beyond holding the focus. `mixed` is a box ticked in part. */
export type AxState = 'checked' | 'mixed' | 'pressed' | 'selected' | 'expanded' | 'collapsed' | 'disabled';

export interface AxNode {
  /** Handle the model acts on. Sequential, assigned by this walk. */
  readonly uid: string;
  readonly role: string;
  readonly name: string;
  readonly value?: string;
  /** CDP backend node id — how the action layer resolves a uid to a box. */
  readonly backendNodeId?: number;
  /** True when the node currently holds focus. */
  readonly focused?: boolean;
  /** What the page says the element is in (see {@link statesOf}); absent when it says nothing. */
  readonly states?: ReadonlyArray<AxState>;
  /** True when the page says the element is still working (see {@link isInProgress}). */
  readonly inProgress?: boolean;
  /** What the markup says about a control with no name (see `./hints.ts`). */
  readonly hint?: string;
  /**
   * The frame session the node lives in, when it is inside a frame from another
   * site. Its `backendNodeId` means something only in that session.
   */
  readonly frame?: string;
  readonly children: AxNode[];
}

export interface AxTree extends AxNode {
  /** uid → node, so the action layer resolves a handle without re-walking. */
  readonly index: ReadonlyMap<string, AxNode>;
}

/** The label this document uses for a node, minting one on first sight. */
function label(memory: UidMemory, nodeId: string): string {
  const known = memory.byNode.get(nodeId);
  if (known !== undefined) return known;
  const fresh = String(++memory.next);
  memory.byNode.set(nodeId, fresh);
  return fresh;
}

/**
 * Cap on tree depth. Comfortably above any real page and far below the call
 * stack limit, so a malformed or hostile payload yields a truncated tree
 * rather than a `RangeError` that would kill the turn.
 */
const MAX_DEPTH = 200;

/** Read a CDP `{ value: … }` wrapper as a string, or undefined when absent. */
function str(wrapper: { value?: unknown } | undefined): string | undefined {
  const v = wrapper?.value;
  if (v === undefined || v === null) return undefined;
  return typeof v === 'string' ? v : String(v);
}

function isFocused(raw: AxNodeRaw): boolean {
  return (raw.properties ?? []).some((p) => p.name === 'focused' && p.value?.value === true);
}

/**
 * The states CDP reports as properties. A tristate (`checked`, `pressed`) comes
 * as the text "true" / "false" / "mixed" and a boolean as a boolean, so each is
 * compared with what it means: `Boolean("false")` would tick every box. An
 * absent property says nothing, and only `expanded: false` is a state of its
 * own — a section that could open and is closed.
 */
function statesOf(raw: AxNodeRaw): AxState[] {
  const read = new Map((raw.properties ?? []).map((property) => [property.name, property.value?.value]));
  const on = (name: string): boolean => read.get(name) === true || read.get(name) === 'true';
  const states: AxState[] = [];
  if (on('checked')) states.push('checked');
  else if (read.get('checked') === 'mixed') states.push('mixed');
  if (on('pressed')) states.push('pressed');
  if (on('selected')) states.push('selected');
  if (on('expanded')) states.push('expanded');
  else if (read.get('expanded') === false || read.get('expanded') === 'false') states.push('collapsed');
  if (on('disabled')) states.push('disabled');
  return states;
}

/**
 * Whether the page itself declares the element still working: `aria-busy`, or
 * a progress bar that shows no amount (the spinner kind). A bar with an amount
 * is left out — a disk or quota gauge is drawn the same way, and calling every
 * gauge "work under way" would make the signal worthless.
 */
function hintOf(raw: AxNodeRaw, hints: ReadonlyMap<number, string> | undefined): { hint?: string } {
  if (str(raw.name) || raw.backendDOMNodeId === undefined) return {};
  const hint = hints?.get(raw.backendDOMNodeId);
  return hint ? { hint } : {};
}

/** A document's own busy means it is still loading, which some pages never finish; it is no task's state. */
const DOCUMENTS = new Set(['RootWebArea', 'WebArea']);

function isInProgress(raw: AxNodeRaw): boolean {
  if (DOCUMENTS.has(str(raw.role) ?? '')) return false;
  const props = raw.properties ?? [];
  // Chromium reports aria-busy="true" as 1; other builds may say true.
  if (props.some((p) => p.name === 'busy' && (p.value?.value === true || p.value?.value === 1))) return true;
  return str(raw.role) === 'progressbar' && str(raw.value) === undefined;
}

/**
 * Fold the flat CDP node list into a tree.
 *
 * An `ignored` node contributes no row of its own but its children are hoisted
 * into the parent — a presentational wrapper must never swallow the button
 * underneath it. Unresolvable child ids are skipped, and a node already
 * visited on this walk is not re-entered, so a cyclic payload terminates.
 */
/**
 * uids that mean the same element from one read to the next.
 *
 * A counter in document order was the obvious first answer and the wrong one:
 * inserting a single element near the top renumbers everything below it, and a
 * page where every uid moved is a page where nothing can be described as
 * unchanged. Measured on a Wikipedia article — one added element left 1% of the
 * rendered lines matching.
 *
 * Chromium's own accessibility node ids do not move: after that insertion all
 * 17,644 nodes carrying a DOM node kept theirs and none changed. Those are the
 * stable thing; this maps them to short labels, because sending the raw ids
 * would cost several characters a line on a tree with tens of thousands of them.
 *
 * One memory per document. A navigation starts a new one — the old page's
 * elements are gone and reusing their labels would be a lie.
 */
export interface UidMemory {
  /** accessibility node id → the label this document has been calling it. */
  readonly byNode: Map<string, string>;
  /** Next label to hand out. */
  next: number;
}

export function newUidMemory(): UidMemory {
  return { byNode: new Map(), next: 0 };
}

export function buildAxTree(
  nodes: ReadonlyArray<AxNodeRaw>,
  memory?: UidMemory,
  hints?: ReadonlyMap<number, string>,
): AxTree | null {
  const root = nodes[0];
  if (!root) return null;

  const byId = new Map<string, AxNodeRaw>();
  for (const n of nodes) byId.set(n.nodeId, n);

  const index = new Map<string, AxNode>();
  const visited = new Set<string>();
  let counter = 0;

  /** Convert one raw node, returning the rows it contributes to its parent. */
  const walk = (raw: AxNodeRaw, depth: number): AxNode[] => {
    if (visited.has(raw.nodeId) || depth > MAX_DEPTH) return [];
    visited.add(raw.nodeId);

    const descend = (): AxNode[] => {
      const out: AxNode[] = [];
      for (const childId of raw.childIds ?? []) {
        const child = byId.get(childId);
        if (child) out.push(...walk(child, depth + 1));
      }
      return out;
    };

    // Ignored: contribute the children in this node's place, and consume no uid.
    if (raw.ignored) return descend();

    // Reserve the uid BEFORE descending so numbering reads in document order
    // (parent before its children) — that is the order the model sees the text
    // in, and a uid that jumps around is a uid nobody can reason about. With a
    // memory, a node the document has been seen with before keeps its label and
    // only genuinely new nodes take a fresh one.
    const uid = memory ? label(memory, raw.nodeId) : String(++counter);
    const children = descend();
    const states = statesOf(raw);

    const node: AxNode = {
      uid,
      role: str(raw.role) ?? 'unknown',
      name: str(raw.name) ?? '',
      ...(str(raw.value) !== undefined ? { value: str(raw.value) } : {}),
      ...(raw.backendDOMNodeId !== undefined ? { backendNodeId: raw.backendDOMNodeId } : {}),
      ...(isFocused(raw) ? { focused: true } : {}),
      ...(states.length > 0 ? { states } : {}),
      ...(isInProgress(raw) ? { inProgress: true } : {}),
      ...hintOf(raw, hints),
      ...(raw.frame !== undefined ? { frame: raw.frame } : {}),
      children,
    };
    index.set(node.uid, node);
    return [node];
  };

  const built = walk(root, 0);
  const top = built[0];
  if (!top) return null;
  return { ...top, index };
}
