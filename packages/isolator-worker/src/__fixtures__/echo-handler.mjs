// Plain ESM JS fixture for the worker isolator's tests. Not part of
// the published build — lives outside tsconfig include so tsc ignores it.

export async function echoHandler(input, ctx) {
  return { input, sessionId: ctx.sessionId, cwd: ctx.cwd };
}

export async function slowHandler(input) {
  await new Promise((r) => setTimeout(r, input.ms));
  return 'done';
}

export async function throwHandler() {
  throw new Error('intentional failure');
}

// Reads a process-level variable. In the parent thread, this would be
// set by the test runner; in the worker, the variable is undefined.
// This is how we prove the worker has its own isolated state.
export async function readGlobalHandler() {
  // eslint-disable-next-line no-undef
  return { seen: globalThis.__MOXXY_TEST_FLAG__ ?? null };
}
