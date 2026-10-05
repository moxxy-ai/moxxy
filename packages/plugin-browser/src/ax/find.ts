/**
 * Looking something up on a page instead of reading the page.
 *
 * A search over the rows a read would show, done here rather than by the
 * model: it costs nothing to run and its answer is a few rows, each with the
 * uid to act on. Over the whole rendering, so it reaches what a read's budget
 * left out.
 */

/** Rows a lookup gives back; past this the query is too broad to act on. */
export const MAX_FOUND = 20;

export interface Found {
  readonly rows: string[];
  /** How many rows matched, the ones past {@link MAX_FOUND} included. */
  readonly total: number;
}

/** Roles that name something else on the page rather than being acted on. */
const LABEL_ROLES: ReadonlySet<string> = new Set(['StaticText', 'LabelText']);
/** Roles a value is put into. */
const FIELD_ROLES: ReadonlySet<string> = new Set([
  'textbox',
  'searchbox',
  'combobox',
  'spinbutton',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'listbox',
]);
/** How far past a label its field may stand: the label's own text rows, then the field. */
const FIELD_LOOKAHEAD = 4;

const UID_ROW = /^\s*\[\d+\]\s+([^\s:]+)/;

/**
 * Rows of `rendering` that contain every word of `query`, in any order and
 * any case. A label that matches brings the field after it: a form whose
 * labels are not tied to their fields leaves the field nameless, or named by
 * whatever it holds, so the label is the only way to ask for it.
 */
export function findRows(rendering: string, query: string): Found {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { rows: [], total: 0 };
  const lines = rendering.split('\n').filter((line) => UID_ROW.test(line));
  const rows: string[] = [];
  let total = 0;
  for (const [at, line] of lines.entries()) {
    const lower = line.toLowerCase();
    if (!words.every((word) => lower.includes(word))) continue;
    total += 1;
    if (total > MAX_FOUND) continue;
    rows.push(line.trim());
    if (!LABEL_ROLES.has(roleOf(line))) continue;
    const field = lines.slice(at + 1, at + 1 + FIELD_LOOKAHEAD).find((next) => FIELD_ROLES.has(roleOf(next)));
    if (field) rows.push(`  → field: ${field.trim()}`);
  }
  return { rows, total };
}

function roleOf(line: string): string {
  return UID_ROW.exec(line)?.[1] ?? '';
}
