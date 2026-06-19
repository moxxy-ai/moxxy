/**
 * Shared, transport-agnostic source fragments for the worker / subprocess
 * isolator shims.
 *
 * Both isolators inline a JS "shim" string that runs INSIDE the isolated
 * worker / child: it imports the handler module, builds a synthetic
 * `ToolContext` whose `fs` / `fetch` / `exec` are capability-broker proxies,
 * calls the handler, and reports the result. The transport differs (the
 * worker posts over `parentPort`; the subprocess writes NDJSON to stdout), so
 * each isolator keeps its own `rpc` / framing / abort plumbing — but the two
 * pieces that touch NEITHER transport were duplicated verbatim:
 *
 *  1. the `broker` object literal (the `fs`/`fetch`/`exec` RPC wrappers), and
 *  2. the synthetic `ctx` object literal.
 *
 * Single-sourcing them here keeps the brokered surface (which ops a sandboxed
 * tool can reach) defined in exactly ONE place: drift between the two
 * isolators would mean a tool sees a different capability surface depending on
 * which isolator the host happened to pick — a security-relevant divergence.
 *
 * These are interpolated into each isolator's transport-specific shim, so the
 * bytes that ultimately execute are identical to the previous inline copies.
 * The fragments depend only on two free identifiers the host shim must define
 * before interpolating them: `rpc(op, args)` (the transport RPC call) and
 * `abortController` (the cooperative-cancel controller handed to the handler
 * as `ctx.signal`).
 */

/**
 * The `broker` object literal: `fs.{readFile,writeFile,readdir,stat}`,
 * `fetch`, and `exec`, each forwarding to the host via `rpc(op, args)`.
 * Defines `const broker = {...}`; assumes a `rpc` function is in scope.
 *
 * This is the boundary of what a sandboxed tool can do to the host — adding
 * an op here widens that boundary for BOTH isolators at once.
 */
export const BROKER_CLIENT_SOURCE = `
const broker = {
  fs: {
    readFile: (filePath, opts) => rpc('fs.readFile', [filePath, opts || {}]),
    writeFile: (filePath, data) => rpc('fs.writeFile', [filePath, data]),
    readdir: (dirPath) => rpc('fs.readdir', [dirPath]),
    stat: (filePath) => rpc('fs.stat', [filePath]),
  },
  fetch: (url, init) => rpc('fetch', [url, init || {}]),
  exec: (cmd, args, opts) => rpc('exec', [cmd, args || [], opts || {}]),
};`;

/**
 * The synthetic `ToolContext` literal passed to the handler. Defines
 * `const ctx = {...}`; assumes `syntheticCtx` (the host-provided plain
 * fields), `abortController`, and `broker` (see {@link BROKER_CLIENT_SOURCE})
 * are in scope. `log` is an inert stub — a sandboxed handler gets no view of
 * the session event log — and `logger` is a no-op.
 */
export const SYNTHETIC_CTX_SOURCE = `
const ctx = {
  sessionId: syntheticCtx.sessionId,
  turnId: syntheticCtx.turnId,
  callId: syntheticCtx.callId,
  cwd: syntheticCtx.cwd,
  signal: abortController.signal,
  log: { length: 0, at: () => undefined, slice: () => [], ofType: () => [], byTurn: () => [], toJSON: () => [] },
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  fs: broker.fs,
  fetch: broker.fetch,
  exec: broker.exec,
};`;
