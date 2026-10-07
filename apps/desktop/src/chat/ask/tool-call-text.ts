/**
 * What a tool is about to do, written out for the person asked to allow it.
 *
 * Nothing is shortened. The transcript's one-line summary cuts each value to a
 * few characters, which is right for a row and wrong for an approval: the
 * text here is the text being vouched for.
 */
export function toolCallText(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return input;
  if (typeof input !== 'object') return String(input);
  const entries = Object.entries(input as Record<string, unknown>);
  const [only] = entries;
  if (only === undefined) return '';
  // One text argument is the call itself: a command, a path, a query.
  if (entries.length === 1 && typeof only[1] === 'string') return only[1];
  return entries.map(([name, value]) => argumentText(name, value)).join('\n');
}

function argumentText(name: string, value: unknown): string {
  if (typeof value !== 'string') return `${name}: ${jsonText(value)}`;
  if (!value.includes('\n')) return `${name}: ${value}`;
  const lines = value.split('\n').map((line) => `  ${line}`);
  return `${name}:\n${lines.join('\n')}`;
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
