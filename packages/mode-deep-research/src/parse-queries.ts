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
  // "(none)" sentinel — the model is telling us no follow-ups are needed.
  if (/followups\s*:\s*\(none\)/i.test(text)) return [];
  return parseNumberedBlock(text, /^followups\s*:?$/i);
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
