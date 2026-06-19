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

// Exits the worker cleanly (code 0) WITHOUT ever posting a terminal
// `result` message. A handler (or a transitive import) calling
// process.exit(0) is a protocol violation: the parent must reject
// immediately on the early exit, not stall until the budget timer.
export async function cleanExitHandler() {
  process.exit(0);
}

// Returns a value the V8 structured-clone serializer cannot handle (a
// function). The worker shim's own postMessage of the result throws a
// synchronous DataCloneError, which the shim catches and re-posts as a
// clean error `result` — the parent must reject fast with that error,
// never stall to the budget and never crash the worker.
export async function nonCloneableHandler() {
  return { fn: () => 42, ok: true };
}

// Posts a stray, unrecognized message type to the parent BEFORE
// returning normally. The parent's onMessage must ignore the unknown
// type (not coerce it into a spurious `new Error(undefined)` rejection)
// and still settle on the subsequent terminal `result`. `node:worker_threads`
// is not on the blocklist (the shim itself needs it), so a handler can
// reach `parentPort`.
export async function strayMessageThenResolveHandler(input) {
  const { parentPort } = await import('node:worker_threads');
  parentPort.postMessage({ type: 'note', detail: 'forward-compat ping' });
  parentPort.postMessage({ unrelated: true });
  return { ok: true, echoed: input };
}
