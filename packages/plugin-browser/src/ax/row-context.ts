import type { AxNode } from './tree.js';

/** A nested section owns its controls rather than borrowing the outer row. */
export const AX_SECTIONS: ReadonlySet<string> = new Set(['RootWebArea', 'main', 'banner', 'contentinfo', 'complementary', 'navigation', 'region', 'dialog', 'alertdialog', 'article', 'listitem', 'group']);
/** Decorative descendants are drawings, not a source for a row's label. */
export const AX_OPAQUE_ROLES: ReadonlySet<string> = new Set(['SvgRoot', 'graphics-symbol', 'Canvas', 'img']);

/** A list row's own label, without borrowing one from a nested section. */
export function rowLabelOf(node: AxNode, limit: number): string | undefined {
  const pending = [...node.children].reverse();
  while (pending.length > 0) {
    const child = pending.pop();
    if (!child) continue;
    if (AX_OPAQUE_ROLES.has(child.role)) continue;
    if (child.role === 'LabelText') {
      const words: string[] = [];
      const text = child.name ? [] : [...child.children].reverse();
      while (text.length > 0) {
        const part = text.pop();
        if (!part) continue;
        if (AX_OPAQUE_ROLES.has(part.role)) continue;
        if (part.role === 'StaticText') {
          if (part.name.trim()) words.push(part.name.trim());
        } else text.push(...[...part.children].reverse());
      }
      const label = (child.name || words.join(' ')).trim();
      if (label) return label.length <= limit ? label : `${label.slice(0, limit)}…`;
    } else if (!AX_SECTIONS.has(child.role)) pending.push(...[...child.children].reverse());
  }
  return undefined;
}
