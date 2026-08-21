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
}

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
  readonly children: AxNode[];
}

export interface AxTree extends AxNode {
  /** uid → node, so the action layer resolves a handle without re-walking. */
  readonly index: ReadonlyMap<string, AxNode>;
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
 * Fold the flat CDP node list into a tree.
 *
 * An `ignored` node contributes no row of its own but its children are hoisted
 * into the parent — a presentational wrapper must never swallow the button
 * underneath it. Unresolvable child ids are skipped, and a node already
 * visited on this walk is not re-entered, so a cyclic payload terminates.
 */
export function buildAxTree(nodes: ReadonlyArray<AxNodeRaw>): AxTree | null {
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
    // in, and a uid that jumps around is a uid nobody can reason about.
    const uid = String(++counter);
    const children = descend();

    const node: AxNode = {
      uid,
      role: str(raw.role) ?? 'unknown',
      name: str(raw.name) ?? '',
      ...(str(raw.value) !== undefined ? { value: str(raw.value) } : {}),
      ...(raw.backendDOMNodeId !== undefined ? { backendNodeId: raw.backendDOMNodeId } : {}),
      ...(isFocused(raw) ? { focused: true } : {}),
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
