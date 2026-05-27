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

// Tries to bypass the broker via node:fs. The loader-hook layer
// blocks this at the dynamic-import call.
export async function readEtcHostsDirectly() {
  const fs = await import('node:fs');
  return fs.promises.readFile('/etc/hosts', 'utf8');
}

export async function spawnDirectly() {
  const cp = await import('node:child_process');
  return cp.execSync('echo nope').toString('utf8');
}

export async function bareFsImport() {
  await import('fs');
  return 'should-not-reach-here';
}

// Harmless module — should still load fine.
export async function usePathModule(input) {
  const pathMod = await import('node:path');
  return pathMod.basename(input.input);
}

// Returns whether the broker proxies are present on the injected ctx.
// Smoke test that the shim wires them through.
export async function inspectCtx(_input, ctx) {
  return {
    hasFs: typeof ctx.fs?.readFile === 'function',
    hasWriteFile: typeof ctx.fs?.writeFile === 'function',
    hasReaddir: typeof ctx.fs?.readdir === 'function',
    hasStat: typeof ctx.fs?.stat === 'function',
    hasFetch: typeof ctx.fetch === 'function',
    hasExec: typeof ctx.exec === 'function',
    sessionId: ctx.sessionId,
  };
}

export async function writeViaBroker(input, ctx) {
  await ctx.fs.writeFile(input.where, input.data);
  return 'ok';
}

export async function statViaBroker(input, ctx) {
  return await ctx.fs.stat(input.where);
}

export async function execViaBroker(input, ctx) {
  return await ctx.exec(input.cmd, input.args);
}

// Slow handler for timeout / abort tests.
export async function slowHandler(input) {
  await new Promise((r) => setTimeout(r, input.ms));
  return 'done';
}

// Reads a parent-thread global. Should always come back null in the
// subprocess child (separate OS process = separate heap).
export async function readParentGlobal() {
   
  return { seen: globalThis.__MOXXY_PARENT_FLAG__ ?? null };
}
