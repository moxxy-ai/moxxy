/**
 * A tiny, pure-JS, non-cryptographic hash (FNV-1a, 32-bit) used only to make
 * `hash`-mode redaction tokens stable per value (`john@x.com` → `a1b2c3d4`).
 *
 * Deliberately NOT `node:crypto`: keeping zero Node-builtin coupling is what
 * lets this package bundle into the browser renderer untouched. This is
 * obfuscation for readability, NOT a security primitive — do not rely on it to
 * make a value irreversible.
 */
export function shortHash(input: string, salt = ''): string {
  const str = salt + input;
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime, 32-bit via Math.imul
  }
  return (h >>> 0).toString(36).padStart(8, '0').slice(0, 8);
}
