/**
 * Local copy of `@moxxy/sdk`'s `assertDefined`.
 *
 * This package is bundled into the desktop RENDERER (browser context); a value
 * import from the `@moxxy/sdk` barrel would drag Node-only modules
 * (`node:fs`, `node:os`, ...) into the browser bundle and break the vite
 * build. Type-only sdk imports remain fine. Keep semantics identical to
 * `packages/sdk/src/assert.ts`.
 */
export function assertDefined<T>(value: T, message: string): asserts value is NonNullable<T> {
  if (value === null || value === undefined) {
    throw new Error(`Expected a defined value: ${message}`);
  }
}
