export function textOf(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

export function boolOf(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function recordId(value: Record<string, unknown>, fallback: string): string {
  return textOf(value.id, textOf(value.requestId, fallback));
}
