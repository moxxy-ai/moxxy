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

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
