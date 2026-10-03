import type { AppElement, AppTree } from '@moxxy/jev';
import { MAX_LABEL_CHARS } from './format.js';
import { isSecret } from './snapshot.js';
import type { AxNode } from './tree.js';

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

/** Roles that take text; each carries a value, empty or not, so grounding can tell them from the rest. */
const TAKES_TEXT: ReadonlySet<string> = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);

/** What `appTreeSchema` takes. */
const MAX_ELEMENTS = 5_000;
const MAX_DEPTH = 64;

const clip = (text: string) => (text.length <= MAX_LABEL_CHARS ? text : `${text.slice(0, MAX_LABEL_CHARS)}…`);

export function appTreeOf(root: AxNode, page: { readonly app: string; readonly window?: string }): AppTree {
  const elements: AppElement[] = [];
  let truncated = false;

  /** `place` is the key of the nearest listed container; `kinds` counts each role under it. */
  const walk = (node: AxNode, depth: number, place: string, kinds: Map<string, number>): void => {
    let inside = { depth, place, kinds };
    const index = Number(node.uid);
    if (ACTIONABLE.has(node.role) && Number.isSafeInteger(index)) {
      if (elements.length >= MAX_ELEMENTS) {
        truncated = true;
        return;
      }
      const ordinal = (kinds.get(node.role) ?? 0) + 1;
      kinds.set(node.role, ordinal);
      const key = `${place}/${node.role}[${ordinal}]`;
      elements.push(elementOf(node, index, key, depth));
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

function elementOf(node: AxNode, index: number, key: string, depth: number): AppElement {
  const secret = isSecret(node);
  const value = TAKES_TEXT.has(node.role) ? (node.value ?? '') : node.value;
  return {
    key: key.slice(-512),
    index,
    depth,
    role: node.role.slice(0, 128),
    ...(node.name ? { title: clip(node.name) } : {}),
    ...(secret ? { secure: true } : value === undefined ? {} : { value: clip(value) }),
    ...(node.focused ? { states: ['focused' as const] } : {}),
  };
}
