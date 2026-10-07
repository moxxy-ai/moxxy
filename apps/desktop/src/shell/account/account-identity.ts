/** Two letters for an avatar: first and last name, or the start of a single word. */
export function initialsOf(name: string): string | null {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (!first || !last) return null;
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}

/** An account type as a badge label. Free when the account carries none. */
export function formatTier(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) return 'Free';
  const tier = raw.trim().toLowerCase();
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}
