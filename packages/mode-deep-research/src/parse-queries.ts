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

function parseNumberedBlock(text: string, headerRegex: RegExp): string[] {
  const lines = text.split('\n');
  const items: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (headerRegex.test(line)) {
      continue;
    }
    const m = /^(?:\d+[.)]|[-*•])\s*(.+)$/.exec(line);
    if (m) {
      items.push(m[1]!.trim());
    }
    // Non-list lines (incl. wrapped continuations of a prior item) are
    // dropped: queries/followups are single-line by spec.
  }
  return items;
}
