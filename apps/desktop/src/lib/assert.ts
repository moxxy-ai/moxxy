/**
 * Local narrowing guards for the desktop renderer. The renderer is a browser
 * bundle, and the `@moxxy/sdk` root barrel transitively pulls Node-only modules
 * (`node:fs` via the JSON file store), so importing sdk's
 * `assertDefined`/`invariant` from the barrel at runtime breaks the vite build.
 * These are the same guard-don't-chain helpers, kept dependency-free so they
 * bundle for the browser. Behaviour matches `@moxxy/sdk`.
 */

/**
 * Runtime invariant: throws when `condition` is falsy, narrowing its type
 * otherwise. State an assumption once, then dereference plainly.
 */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Invariant violation: ${message}`);
  }
}

/**
 * Asserts `value` is neither `null` nor `undefined`, narrowing to `NonNullable<T>`.
 * The guard-clause replacement for a non-null assertion (`x!`). Falsy-but-defined
 * values (`0`, `''`, `false`) pass.
 */
export function assertDefined<T>(value: T, message: string): asserts value is NonNullable<T> {
  if (value === null || value === undefined) {
    throw new Error(`Expected a defined value: ${message}`);
  }
}
