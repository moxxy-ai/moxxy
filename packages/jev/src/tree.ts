import { z } from 'zod';

const text = z.string().max(10_000);
const elementSchema = z.object({
  /** Identity that survives re-observation (e.g. role path); the helper keeps an element's index while its key lives. */
  key: z.string().min(1).max(512),
  index: z.number().int().nonnegative(),
  depth: z.number().int().min(0).max(64),
  role: z.string().min(1).max(128),
  title: text.optional(),
  description: text.optional(),
  value: text.optional(),
  secure: z.boolean().optional(),
  states: z.array(z.enum(['focused', 'selected', 'not selected', 'checked', 'expanded', 'collapsed', 'disabled', 'read-only'])).max(6).optional(),
  actions: z.array(z.string().min(1).max(64)).max(32).optional(),
  /** Bounds in the coordinate frame of the state's screenshot. */
  frame: z.object({ x: z.number(), y: z.number(), width: z.number().nonnegative(), height: z.number().nonnegative() }).strict().optional(),
}).strict();

/** One window's accessibility elements as a helper reports them, before they are rendered for the model. */
export const appTreeSchema = z.object({
  app: z.string().min(1).max(512),
  window: z.string().max(1024).optional(),
  /** The system's number for the window, where the helper knows it: two windows may read the same title. */
  windowId: z.string().min(1).max(64).optional(),
  elements: z.array(elementSchema).max(5000),
  truncated: z.boolean().optional(),
}).strict().superRefine((tree, ctx) => {
  const indices = new Set<number>();
  const keys = new Set<string>();
  tree.elements.forEach((element, position) => {
    if (indices.has(element.index)) ctx.addIssue({ code: 'custom', path: ['elements', position, 'index'], message: `Duplicate element index ${element.index}` });
    if (keys.has(element.key)) ctx.addIssue({ code: 'custom', path: ['elements', position, 'key'], message: `Duplicate element key "${element.key}"` });
    indices.add(element.index);
    keys.add(element.key);
  });
});
export type AppTree = z.infer<typeof appTreeSchema>;
export type AppElement = AppTree['elements'][number];
type Element = AppElement;

const quote = (value: string, limit: number) =>
  JSON.stringify(value.length > limit ? `${value.slice(0, limit)}…` : value);

function describe(element: Element, textLimit = 300): string {
  const parts = [element.role];
  if (element.title !== undefined) parts.push(quote(element.title, Math.min(200, textLimit)));
  if (element.description !== undefined) parts.push(`description=${quote(element.description, Math.min(200, textLimit))}`);
  if (element.secure) parts.push('value=<secure>');
  else if (element.value !== undefined) parts.push(`value=${quote(element.value, Math.min(300, textLimit))}`);
  parts.push(...(element.states ?? []));
  if (element.actions?.length) parts.push(`actions=[${element.actions.join(', ')}]`);
  return parts.join(' ');
}

const line = (element: Element, textLimit?: number) => `[${element.index}] ${describe(element, textLimit)}`;

const header = (tree: AppTree) =>
  `App: ${tree.app}${tree.window === undefined ? '' : ` — window ${quote(tree.window, 200)}`}`;

const TRUNCATED = '(tree truncated: not every element is listed)';

/** Every element on its own line, indented by depth, as `[index] role "title" …`; `textLimit` cuts what each one says. */
export function formatElements(tree: AppTree, textLimit?: number): string[] {
  return tree.elements.map((element) => `${'  '.repeat(element.depth)}${line(element, textLimit)}`);
}

export function formatTree(tree: AppTree): string {
  return [header(tree), ...formatElements(tree), ...(tree.truncated ? [TRUNCATED] : [])].join('\n');
}

/**
 * Whether two observations show the same thing in front: the same title, and the same window where both have its
 * number. A new tab keeps its window's number; a new empty window may keep the title of the one before it.
 */
export const sameWindow = (a: Pick<AppTree, 'window' | 'windowId'>, b: Pick<AppTree, 'window' | 'windowId'>) =>
  a.window === b.window && (a.windowId === undefined || b.windowId === undefined || a.windowId === b.windowId);

/** Whether two looks list the same elements; an index is only a position in one look. */
export const sameElements = (a: AppTree, b: AppTree) =>
  JSON.stringify(a.elements.map(({ index: _, ...rest }) => rest)) === JSON.stringify(b.elements.map(({ index: _, ...rest }) => rest));

export interface TreeView { readonly kind: 'full' | 'diff' | 'unchanged'; readonly text: string }

/** Render `next` relative to the state the model saw last; any change of index is listed so no old index is reused. */
export function diffTrees(previous: AppTree | undefined, next: AppTree): TreeView {
  const full: TreeView = { kind: 'full', text: formatTree(next) };
  if (!previous || previous.app !== next.app || !sameWindow(previous, next)) return full;
  const before = new Map(previous.elements.map((element) => [element.key, element]));
  const present = new Set(next.elements.map((element) => element.key));
  const changes: string[] = [];
  let unchanged = 0;
  for (const element of next.elements) {
    const old = before.get(element.key);
    if (!old) changes.push(`+ ${line(element)}`);
    else if (line(old) !== line(element)) changes.push(`~ ${line(element)}`);
    else unchanged += 1;
  }
  for (const element of previous.elements) {
    if (!present.has(element.key)) changes.push(`- ${describe(element)}`);
  }
  if (changes.length === 0) {
    return { kind: 'unchanged', text: `${header(next)}\nNo changes since the previous state; its indices are still valid.` };
  }
  if (unchanged === 0 || changes.length >= next.elements.length) return full;
  return {
    kind: 'diff',
    text: [
      header(next),
      'Changes since the previous state (+ added, ~ changed, - removed; unlisted elements keep their index):',
      ...changes,
      ...(next.truncated ? [TRUNCATED] : []),
    ].join('\n'),
  };
}
