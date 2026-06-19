/**
 * Parse the planner's output into individual sub-question strings — a
 * numbered list under a QUERIES: header.
 */
export function parseQueries(text: string): string[] {
  return parseNumberedBlock(text, /^queries\s*:?$/i);
}

/**
 * Parse the follow-up planner output. Accepts either a numbered list
 * under `FOLLOWUPS:` OR the literal `FOLLOWUPS: (none)` form. Returns
 * an empty array in both the "(none)" and "no parseable items" cases —
 * the loop treats both as "no more research needed, proceed to synthesis".
 */
export function parseFollowups(text: string): string[] {
  const items = parseNumberedBlock(text, /^followups\s*:?$/i);
  // "(none)" sentinel — the model is telling us no follow-ups are needed.
  // Anchor it to a full line so a parenthetical that merely follows the
  // header (e.g. "FOLLOWUPS:\n(none of the prior sources covered cost)\n1. …")
  // doesn't swallow a genuine numbered list below it. Only honor the sentinel
  // when no numbered items were parsed.
  if (items.length === 0 && /^followups\s*:\s*\(none\)\s*$/im.test(text)) return [];
  return items;
}

/**
 * Cap on a single joined query/follow-up. A hostile or malformed model could
 * emit thousands of continuation lines that all attach to one item; bound the
 * per-item growth so a mangled plan can't produce a multi-MB subagent prompt.
 */
const MAX_ITEM_CHARS = 2000;

function parseNumberedBlock(text: string, headerRegex: RegExp): string[] {
  const lines = text.split('\n');
  const items: string[] = [];
  // Tracks whether the previous meaningful line was (or extended) a list item,
  // so we only ever join wrapped continuations onto a real item.
  let continuationOpen = false;
  for (const raw of lines) {
    const line = raw.trim();
    // A blank line ends the current item's continuation run: a wrapped query
    // never spans a blank line, so this prevents an unrelated trailing
    // paragraph from being glued onto the last query.
    if (!line) {
      continuationOpen = false;
      continue;
    }
    if (headerRegex.test(line)) {
      // A header also closes any open continuation run.
      continuationOpen = false;
      continue;
    }
    const m = /^(?:\d+[.)]|[-*•])\s*(.+)$/.exec(line);
    if (m) {
      items.push(m[1]!.trim());
      continuationOpen = true;
      continue;
    }
    // Non-list line. If it directly continues an open item (the model wrapped a
    // long query across lines), join it on rather than silently truncating the
    // query — a dropped continuation gets sent to a subagent as a half-question.
    // A non-list line with NO open item (junk preamble, a "(none …)" header
    // parenthetical, etc.) is still dropped.
    if (continuationOpen && items.length > 0) {
      const last = items[items.length - 1]!;
      const joined = `${last} ${line}`;
      items[items.length - 1] =
        joined.length > MAX_ITEM_CHARS ? joined.slice(0, MAX_ITEM_CHARS) : joined;
    }
  }
  return items;
}
