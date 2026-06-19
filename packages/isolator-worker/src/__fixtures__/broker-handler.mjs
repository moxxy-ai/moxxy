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

// Tries to bypass the broker via node:fs directly. The loader-hook
// layer blocks this at module-resolution time, so the call throws
// "blocked import" before the handler can read anything.
export async function readEtcHostsDirectly() {
  const fs = await import('node:fs');
  return fs.promises.readFile('/etc/hosts', 'utf8');
}

// Same shape for the other dangerous modules — each should fail at
// the dynamic import line, not at the call site.
export async function spawnDirectly() {
  const cp = await import('node:child_process');
  return cp.execSync('echo nope').toString('utf8');
}

export async function netDirectly() {
  await import('node:net');
  return 'should-not-reach-here';
}

export async function bareFsImport() {
  // Bare specifier alias — Node treats this as node:fs. The loader
  // blocks it the same way.
  await import('fs');
  return 'should-not-reach-here';
}

// Harmless modules (node:path, node:url, node:buffer, etc.) MUST
// remain importable — they're how handlers do path math, URL parsing,
// encoding without touching the host.
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

// Fans out many concurrent brokered exec ops (each a short sleep, so they
// stay in-flight together) and tallies how many were rejected with the
// isolator's concurrency-cap error vs. how many completed. Proves the
// parent bounds in-flight brokered work: a hostile worker can't fan out
// unbounded fds / sockets / exec children even though each request line
// is tiny. Input: { count, sleepSec, cmd }.
export async function floodBrokerOps(input, ctx) {
  const count = input?.count ?? 64;
  const sleepSec = String(input?.sleepSec ?? 0.4);
  const cmd = input?.cmd ?? '/bin/sleep';
  let completed = 0;
  let capped = 0;
  let otherError = 0;
  const ops = [];
  for (let i = 0; i < count; i++) {
    ops.push(
      ctx
        .exec(cmd, [sleepSec])
        .then(() => {
          completed++;
        })
        .catch((e) => {
          if (/too many concurrent brokered ops/.test(String(e?.message ?? e))) capped++;
          else otherError++;
        }),
    );
  }
  await Promise.all(ops);
  return { completed, capped, otherError };
}
