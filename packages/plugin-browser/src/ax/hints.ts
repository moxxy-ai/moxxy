/**
 * What the markup says about a control the page gives no name — an icon-only
 * button. The accessibility tree has nothing for it but "button"; the agent
 * then guesses from where it sits, and a close button beside "Please redeploy"
 * was taken for the redeploy. The attribute that wires its click, or a title or
 * id the page gave it, is shown instead, as the page wrote it.
 */

const MAX_HINT = 100;

/** Roles a person acts on, where a missing name leaves the agent guessing. */
export const HINTED_ROLES: ReadonlySet<string> = new Set(['button', 'link', 'menuitem', 'tab', 'switch', 'checkbox', 'radio', 'option']);

/** A click handler wired in markup, by the attribute frameworks use for it. */
const HANDLER = /^(onclick|@click|x-on:click|wire:click|v-on:click|ng-click|hx-(get|post|put|patch|delete))(\.|$)/i;

export function markupHint(attrs: Readonly<Record<string, string>>): string | undefined {
  const named = (name: string): [string, string] | undefined => {
    const value = attrs[name]?.trim();
    return value ? [name, value] : undefined;
  };
  const handler = Object.entries(attrs).find(([name, value]) => HANDLER.test(name) && value.trim());
  const found = named('title') ?? handler ?? named('data-testid') ?? named('data-test') ?? named('id') ?? named('name');
  if (!found) return undefined;
  const [name, value] = found;
  const room = MAX_HINT - name.length - 3;
  const shown = value.trim().replace(/\s+/g, ' ');
  return `${name}="${shown.length > room ? `${shown.slice(0, room - 1)}…` : shown}"`;
}

/** The part of a `DOMSnapshot.captureSnapshot` reply the hints are read from. */
export interface DomSnapshotReply {
  readonly strings?: readonly string[];
  readonly documents?: ReadonlyArray<{
    nodes?: {
      backendNodeId?: readonly number[];
      attributes?: ReadonlyArray<readonly number[]>;
      isClickable?: { index?: readonly number[] };
    };
  }>;
}

/** The page's own document as one capture gives it: what answers a click, and the hints of the given nodes. */
export function readDomSnapshot(
  reply: DomSnapshotReply,
  wanted: ReadonlySet<number>,
): { clickable: ReadonlySet<number>; hints: ReadonlyMap<number, string> } {
  const nodes = reply.documents?.[0]?.nodes;
  const ids = nodes?.backendNodeId ?? [];
  const strings = reply.strings ?? [];
  const clickable = new Set((nodes?.isClickable?.index ?? []).flatMap((at) => (ids[at] === undefined ? [] : [ids[at]])));
  const hints = new Map<number, string>();
  if (wanted.size > 0) {
    ids.forEach((id, at) => {
      if (!wanted.has(id)) return;
      const flat = nodes?.attributes?.[at] ?? [];
      const attrs: Record<string, string> = {};
      for (let i = 0; i + 1 < flat.length; i += 2) attrs[strings[flat[i] ?? -1] ?? ''] = strings[flat[i + 1] ?? -1] ?? '';
      const hint = markupHint(attrs);
      if (hint) hints.set(id, hint);
    });
  }
  return { clickable, hints };
}
