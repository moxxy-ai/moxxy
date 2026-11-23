/** Two letters for an avatar: first and last name, or the start of a single word. */
export function initialsOf(name: string): string | null {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (!first || !last) return null;
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}

/** Clerk's v2 session token identifies the active plan as scope:slug. */
export function personalPlanLabel(claim: unknown): string | null {
  if (typeof claim !== 'string') return null;
  const match = /^u:([a-z0-9]+(?:[-_][a-z0-9]+)*)$/i.exec(claim);
  if (!match?.[1]) return null;
  return match[1].replace(/[-_]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}
