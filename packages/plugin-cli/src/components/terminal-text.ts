/** Remove terminal control bytes and cap untrusted labels before Ink renders them. */
export function terminalSafeText(
  value: string,
  maxLength: number,
  options: { readonly multiline?: boolean } = {},
): string {
  const safe = [...value].filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    if (options.multiline && code === 0x0a) return true;
    return code >= 0x20 && !(code >= 0x7f && code <= 0x9f);
  });
  if (safe.length <= maxLength) return safe.join('');
  return `${safe.slice(0, Math.max(0, maxLength - 1)).join('')}…`;
}
