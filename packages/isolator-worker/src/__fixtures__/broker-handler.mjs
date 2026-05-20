// Fixture handlers exercising the worker isolator's capability broker.
// Lives outside tsconfig include — these run inside the worker, not
// against the test harness.

// Brokered read via ctx.fs.readFile. Input key `where` is deliberately
// not in PATH_WORDS, so the pre-flight input cap-check ignores it and
// the broker becomes the sole enforcer of `caps.fs.read`.
export async function readViaBroker(input, ctx) {
  if (!ctx.fs?.readFile) throw new Error('ctx.fs.readFile not injected');
  return await ctx.fs.readFile(input.where, { encoding: 'utf8' });
}

// Brokered fetch via ctx.fetch. Input key `where` is not in URL_WORDS
// either, so the pre-flight net check ignores it; the broker is the
// sole enforcer of `caps.net`.
export async function fetchViaBroker(input, ctx) {
  if (!ctx.fetch) throw new Error('ctx.fetch not injected');
  const res = await ctx.fetch(input.where, input.init);
  return { status: res.status, body: res.body };
}

// Bypasses the broker by importing node:fs directly. Demonstrates
// that the broker is advisory: a misbehaving handler can still touch
// fs without mediation. Documented in guides/security.md.
export async function readEtcHostsDirectly() {
  const fs = await import('node:fs');
  return fs.promises.readFile('/etc/hosts', 'utf8');
}

// Returns whether the broker proxies are present on the injected ctx.
// Smoke test that the shim wires them through.
export async function inspectCtx(_input, ctx) {
  return {
    hasFs: typeof ctx.fs?.readFile === 'function',
    hasFetch: typeof ctx.fetch === 'function',
    sessionId: ctx.sessionId,
  };
}
