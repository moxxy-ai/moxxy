// Plain ESM JS fixture for the worker isolator's tests. Not part of
// the published build — lives outside tsconfig include so tsc ignores it.

export async function echoHandler(input, ctx) {
  return { input, sessionId: ctx.sessionId, cwd: ctx.cwd };
}

export async function slowHandler(input) {
  await new Promise((r) => setTimeout(r, input.ms));
  return 'done';
}

// Proves the synthetic ctx.signal is actually wired to the parent's
// abort/timeout. The handler blocks until ctx.signal fires, then — as
// its cooperative cleanup — writes a sentinel file THROUGH the broker
// (ctx.fs.writeFile). The parent services that brokered write during
// the abort grace window, so the test can observe the sentinel on disk
// and know the in-worker signal genuinely fired (rather than the
// worker being blindly hard-killed with a permanently-inert signal).
//
// `input.sentinel` is the path to write; it must be inside the declared
// fs.write cap. A permanently-inert signal would leave this handler
// parked forever and the sentinel would never appear.
export async function signalFlushHandler(input, ctx) {
  if (!ctx.signal.aborted) {
    await new Promise((resolve) => {
      ctx.signal.addEventListener('abort', () => resolve(), { once: true });
    });
  }
  await ctx.fs.writeFile(input.sentinel, 'flushed-on-abort');
  return { flushed: true };
}

export async function throwHandler() {
  throw new Error('intentional failure');
}

// Reads a process-level variable. In the parent thread, this would be
// set by the test runner; in the worker, the variable is undefined.
// This is how we prove the worker has its own isolated state.
export async function readGlobalHandler() {
   
  return { seen: globalThis.__MOXXY_TEST_FLAG__ ?? null };
}
