/**
 * Parse the completion-check model output into a verdict. The format is
 * enforced by COMPLETION_CHECK_SYSTEM_PROMPT:
 *
 *   VERDICT: GOAL_MET
 *   SUMMARY: <one line>
 *
 *   — or —
 *
 *   VERDICT: GOAL_NOT_MET
 *   REMAINING:
 *   - item
 *   - item
 *
 * Fail-safe: `met` is true ONLY when the model explicitly says GOAL_MET. A
 * missing/garbled verdict parses as NOT met, so the loop keeps working rather
 * than declaring victory on unparseable output.
 */
export interface CompletionVerdict {
  readonly met: boolean;
  readonly summary: string | null;
  readonly remaining: string | null;
}

export function parseCompletion(text: string): CompletionVerdict {
  const met = /^\s*VERDICT:\s*GOAL_MET\s*$/im.test(text);
  return {
    met,
    summary: met ? extractSummary(text) : null,
    remaining: met ? null : extractRemaining(text),
  };
}

function extractSummary(text: string): string | null {
  const m = /^\s*SUMMARY:\s*(.+?)\s*$/im.exec(text);
  return m ? m[1]!.trim() : null;
}

function extractRemaining(text: string): string | null {
  const lines = text.split('\n');
  const startIdx = lines.findIndex((l) => /^\s*REMAINING:\s*$/i.test(l));
  if (startIdx === -1) return null;
  const after = lines.slice(startIdx + 1);
  // Trim leading/trailing blank lines; keep the bullet block verbatim.
  while (after.length > 0 && after[0]!.trim() === '') after.shift();
  while (after.length > 0 && after[after.length - 1]!.trim() === '') after.pop();
  return after.length > 0 ? after.join('\n') : null;
}
