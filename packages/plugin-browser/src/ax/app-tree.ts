import type { AppElement, AppTree } from '@moxxy/jev';
import { MAX_LABEL_CHARS, unnamedTitle } from './format.js';
import { isSecret } from './snapshot.js';
import { TAKES_TEXT, type AxNode, type AxState } from './tree.js';

/**
 * A page as Jev reads it: the elements one can act on, each under the uid the
 * browser tools use, nested as they contain each other. Text and landmarks stay
 * out — Jev picks one element of these, and an option that cannot be acted on
 * is only one more way to pick wrong.
 */

/** Roles a step can click, type into, pick from or hover. */
const ACTIONABLE: ReadonlySet<string> = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'option',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'spinbutton',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'treeitem',
  'DisclosureTriangle',
]);

/** What `appTreeSchema` takes. */
const MAX_ELEMENTS = 5_000;
const MAX_DEPTH = 64;

const clip = (text: string) => (text.length <= MAX_LABEL_CHARS ? text : `${text.slice(0, MAX_LABEL_CHARS)}…`);

/** The lines of text a node shows, in reading order. */
function linesOf(node: AxNode, out: string[] = []): string[] {
  for (const child of node.children) {
    if (child.role === 'StaticText') {
      const line = child.name.trim();
      if (line) out.push(line);
    } else linesOf(child, out);
  }
  return out;
}

/**
 * A node with no role that the page answers clicks on — a card, a tile — named
 * by the text it shows: its first line is what a person calls it.
 *
 * Only something with a label's worth of text: a wrapper that answers clicks
 * anywhere on the page shows the whole page, and as an option it is one more
 * way to pick wrong.
 */
function shownAs(node: AxNode): { title: string; description?: string } | undefined {
  const [first, ...rest] = node.name ? [node.name, ...linesOf(node)] : linesOf(node);
  if (first === undefined || first.length > MAX_LABEL_CHARS) return undefined;
  const description = rest.join(' ');
  if (first.length + description.length > MAX_LABEL_CHARS * 2) return undefined;
  return description ? { title: first, description: clip(description) } : { title: first };
}

/** A field named by its label; what it was called before — usually its placeholder — becomes its description. */
const labelledAs = (node: AxNode, label: string): { title: string; description?: string } =>
  node.name ? { title: clip(label), description: clip(node.name) } : { title: clip(label) };

export function appTreeOf(
  root: AxNode,
  page: { readonly app: string; readonly window?: string },
  /** Backend ids of the nodes the browser says answer a click, read alongside the tree. */
  opts: { readonly clickable?: ReadonlySet<number> } = {},
): AppTree {
  const answersClicks = (node: AxNode) =>
    !ACTIONABLE.has(node.role) &&
    node.role !== 'RootWebArea' &&
    node.frame === undefined &&
    node.backendNodeId !== undefined &&
    opts.clickable?.has(node.backendNodeId) === true;
  const elements: AppElement[] = [];
  let truncated = false;

  /**
   * The text of the last `<label>` read since the previous control. A label tied
   * to its field already names it; one that is not — Coolify's settings — stands
   * right before the field it is for, and nothing else names that field.
   */
  let label: string | undefined;

  /** `place` is the key of the nearest listed container; `kinds` counts each role under it. */
  const walk = (node: AxNode, depth: number, place: string, kinds: Map<string, number>): void => {
    let inside = { depth, place, kinds };
    const index = Number(node.uid);
    if (node.role === 'LabelText') label = (node.name || linesOf(node).join(' ')).trim() || label;
    const shown = answersClicks(node) ? shownAs(node) : undefined;
    const nameless = !shown && !node.name && !node.hint && node.value === undefined && !TAKES_TEXT.has(node.role);
    if ((ACTIONABLE.has(node.role) || shown) && !nameless && Number.isSafeInteger(index)) {
      if (elements.length >= MAX_ELEMENTS) {
        truncated = true;
        return;
      }
      const ordinal = (kinds.get(node.role) ?? 0) + 1;
      kinds.set(node.role, ordinal);
      const key = `${place}/${node.role}[${ordinal}]`;
      const labelled = TAKES_TEXT.has(node.role) && label !== undefined && label !== node.name ? labelledAs(node, label) : undefined;
      elements.push({ ...elementOf(node, index, key, depth), ...(shown ?? labelled ?? {}) });
      label = undefined;
      inside = { depth: Math.min(depth + 1, MAX_DEPTH), place: key, kinds: new Map() };
    }
    for (const child of node.children) walk(child, inside.depth, inside.place, inside.kinds);
  };

  walk(root, 1, '', new Map());
  return {
    app: page.app,
    ...(page.window ? { window: page.window.slice(0, 1024) } : {}),
    elements,
    ...(truncated ? { truncated } : {}),
  };
}

type JevState = NonNullable<AppElement['states']>[number];

/** Jev's word for each state. Mixed stays distinct from both on and off. */
const JEV_STATE: Partial<Record<AxState, JevState>> = {
  checked: 'checked',
  mixed: 'mixed',
  pressed: 'selected',
  'not pressed': 'not selected',
  selected: 'selected',
  expanded: 'expanded',
  collapsed: 'collapsed',
  disabled: 'disabled',
  'read-only': 'read-only',
};

function statesOf(node: AxNode): JevState[] {
  const said = (node.states ?? []).flatMap((state) => JEV_STATE[state] ?? []);
  return [...new Set<JevState>([...(node.focused ? (['focused'] as const) : []), ...said])];
}

function elementOf(node: AxNode, index: number, key: string, depth: number): AppElement {
  const secret = isSecret(node);
  const value = TAKES_TEXT.has(node.role) ? (node.value ?? '') : node.value;
  const states = statesOf(node);
  return {
    key: key.slice(-512),
    index,
    depth,
    role: node.role.slice(0, 128),
    ...(node.name ? { title: clip(node.name) } : node.hint ? { title: clip(unnamedTitle(node.hint)) } : {}),
    ...(secret ? { secure: true } : value === undefined ? {} : { value: clip(value) }),
    ...(states.length > 0 ? { states } : {}),
  };
}
