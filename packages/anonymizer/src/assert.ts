/**
 * Local narrowing guard for this package. `@moxxy/anonymizer` intentionally has
 * no `@moxxy/sdk` dependency (it also ships inside the offline desktop
 * anonymizer app), so it can't import sdk's `assertDefined`. This is the same
 * guard-don't-chain idea: fail loudly at the assumption site instead of a
 * non-null assertion that hides it. It returns the value so it composes inline.
 *
 * Only `null`/`undefined` fail — falsy-but-defined values (`0`, `''`, `false`)
 * pass. That matters here: several checksum weight tables legitimately contain
 * `0`, so a truthiness test would wrongly reject them.
 */
export function required<T>(value: T, message: string): NonNullable<T> {
  if (value === null || value === undefined) {
    throw new Error(`Expected a defined value: ${message}`);
  }
  return value as NonNullable<T>;
}
