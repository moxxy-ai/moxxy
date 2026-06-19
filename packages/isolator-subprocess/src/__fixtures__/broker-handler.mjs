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

// Returns the child's own working directory. Used to prove the spawn
// honours `call.cwd` (otherwise process.cwd() would be the parent's dir).
export async function reportCwd() {
  return { cwd: process.cwd() };
}

// Traps SIGTERM (so the cooperative kill is a no-op) and then spins in a
// tight synchronous CPU loop forever. Used to prove the isolator
// escalates to an unmaskable SIGKILL after the grace period. The child's
// pid is written through the broker first so the test can observe that
// the OS actually reaps the process.
export async function sigtermIgnorerSpin(input, ctx) {
  process.on('SIGTERM', () => {
    /* swallow the cooperative signal */
  });
  if (input?.pidFile) {
    await ctx.fs.writeFile(input.pidFile, String(process.pid));
  }
  // Busy-loop synchronously — the event loop never turns again, so a
  // SIGTERM handler can't run and the process can only be stopped by
  // SIGKILL.
   
  for (;;) {
    Math.sqrt(Math.random());
  }
}

// Reports the child process's curated environment: whether specific keys
// are visible. Used to prove the isolator's headline env-restriction
// property — a parent var NOT in the allowlist (or caps.env) must be
// absent in the child, while the default allowlist (e.g. PATH) is present.
export async function reportEnv(input) {
  const keys = input?.keys ?? [];
  const present = {};
  for (const k of keys) present[k] = k in process.env;
  return { present, count: Object.keys(process.env).length };
}

// Reads a parent-thread global. Should always come back null in the
// subprocess child (separate OS process = separate heap).
export async function readParentGlobal() {

  return { seen: globalThis.__MOXXY_PARENT_FLAG__ ?? null };
}

// Floods stdout with a single, newline-free chunk far larger than the
// isolator's output cap, with no terminal `result`. Used to prove the
// parent bounds its own buffering and rejects instead of OOMing.
export async function floodStdout() {
  const block = 'x'.repeat(1024 * 1024);
  // Never emits a newline, so the parent can't frame it as a protocol
  // line — it must hit the byte cap.
  for (let i = 0; i < 64; i++) process.stdout.write(block);
  await new Promise((r) => setTimeout(r, 10_000));
  return 'should-not-resolve';
}

// Calls process.exit(non-zero) with NOTHING on stderr. Used to prove the
// exit handler still produces a diagnostic ("exited with code N") rather
// than hanging or surfacing an empty message.
export async function exitNonZeroSilently() {
  process.exit(7);
}

// Proves ctx.signal is a LIVE controller (not the old inert one): when
// the parent's cooperative abort fires, the handler observes it via
// ctx.signal and writes a marker file through the broker BEFORE the
// SIGTERM/SIGKILL escalation. The test asserts the marker exists, which
// can only happen if ctx.signal actually fired. Input: { marker } path.
export async function flushOnAbort(input, ctx) {
  if (!ctx.signal || typeof ctx.signal.addEventListener !== 'function') {
    throw new Error('ctx.signal is not a live AbortSignal');
  }
  await new Promise((resolve) => {
    if (ctx.signal.aborted) {
      resolve();
      return;
    }
    ctx.signal.addEventListener('abort', () => resolve(), { once: true });
  });
  // Cooperative flush within already-held caps (broker re-checks).
  await ctx.fs.writeFile(input.marker, 'aborted');
  // Sleep so the parent's rejection wins the race regardless.
  await new Promise((r) => setTimeout(r, 5_000));
  return 'flushed';
}

// Allocates an ever-growing array of large strings to blow past a tight
// --max-old-space-size ceiling, proving caps.memMb is enforced via V8 in
// the child (the child crashes; the host is unaffected).
export async function memoryHog() {
  const chunks = [];
  for (;;) {
    // ~10MB per push; with a small memMb cap V8 aborts the child.
    chunks.push('y'.repeat(10 * 1024 * 1024));
  }
}

// Fans out many concurrent brokered exec ops (each a short sleep, so they
// stay in-flight together) and tallies how many were rejected with the
// isolator's concurrency-cap error vs. how many completed. Proves the
// parent bounds in-flight brokered work: a hostile child can't fan out
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
