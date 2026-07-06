/**
 * Exhaustiveness guard for discriminated unions. Put it in the `default:` branch
 * (or any spot the type system has narrowed to `never`): if a new union member
 * is added without a matching case, the call becomes a **compile error** instead
 * of a silent runtime no-op.
 *
 * ```ts
 * switch (action.kind) {
 *   case 'a': return handleA(action);
 *   case 'b': return handleB(action);
 *   default:  return assertNever(action);
 * }
 * ```
 *
 * At runtime — should the narrowing be defeated by an untyped caller — it throws
 * with the offending value, surfacing the bug rather than swallowing it.
 */
export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `assertNever: unexpected value ${stringify(value)}`);
}

/**
 * Runtime invariant: throws when `condition` is falsy, narrowing its type
 * otherwise. State an assumption once at the top of a function, then
 * dereference plainly — instead of an optional chain that silently yields
 * `undefined` far from the cause.
 */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Invariant violation: ${message}`);
  }
}

/**
 * Asserts `value` is neither `null` nor `undefined`, narrowing to `NonNullable<T>`.
 * The guard-clause replacement for a non-null assertion (`x!`): it fails loudly
 * at the assumption site with a message instead of hiding the assumption.
 * Falsy-but-defined values (`0`, `''`, `false`) pass.
 */
export function assertDefined<T>(value: T, message: string): asserts value is NonNullable<T> {
  if (value === null || value === undefined) {
    throw new Error(`Expected a defined value: ${message}`);
  }
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
