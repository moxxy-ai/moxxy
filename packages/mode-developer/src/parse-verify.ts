/**
 * Parse the verify-phase model output into a one-line summary plus a
 * commit message (subject + optional body). The format is enforced by
 * VERIFY_SYSTEM_PROMPT:
 *
 *   SUMMARY: <one line>
 *   COMMIT:
 *   <subject line>
 *
 *   <optional body>
 *
 * Tolerates leading/trailing whitespace and missing body. Returns null
 * fields when the parser couldn't find the expected markers — caller
 * decides whether that's fatal or skippable.
 */
export interface VerifyOutput {
  readonly summary: string | null;
  readonly commitSubject: string | null;
  readonly commitBody: string | null;
}

export function parseVerify(text: string): VerifyOutput {
  const summary = extractSummary(text);
  const { subject, body } = extractCommit(text);
  return { summary, commitSubject: subject, commitBody: body };
}

function extractSummary(text: string): string | null {
  const m = /^\s*SUMMARY:\s*(.+?)\s*$/mi.exec(text);
  return m ? m[1]!.trim() : null;
}

function extractCommit(text: string): { subject: string | null; body: string | null } {
  // Find the COMMIT: marker line, then everything after it.
  const lines = text.split('\n');
  const startIdx = lines.findIndex((l) => /^\s*COMMIT:\s*$/i.test(l));
  if (startIdx === -1) return { subject: null, body: null };

  const after = lines.slice(startIdx + 1);
  // Drop leading blank lines so the first non-empty line is the subject.
  let i = 0;
  while (i < after.length && after[i]!.trim() === '') i++;
  if (i >= after.length) return { subject: null, body: null };

  const subject = after[i]!.trim();
  // Body = remaining lines, with one separator blank line trimmed off the
  // front and trailing blanks trimmed off the end.
  let bodyLines = after.slice(i + 1);
  while (bodyLines.length > 0 && bodyLines[0]!.trim() === '') bodyLines.shift();
  while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1]!.trim() === '') bodyLines.pop();
  const body = bodyLines.length > 0 ? bodyLines.join('\n') : null;
  return { subject, body };
}

/** Join the parsed subject + body into a single commit-message string. */
export function formatCommitMessage(subject: string, body: string | null): string {
  return body ? `${subject}\n\n${body}` : subject;
}
