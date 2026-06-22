import {
  promises as fs,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  realpathSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import * as path from 'node:path';
import { definePlugin, type CapabilitySpec, type IsolatedToolCall, type Isolator, type Plugin } from '@moxxy/sdk';
import { checkAllCaps, pathInScope, buildBrokerEnv, expandHomeAndCwd } from '@moxxy/plugin-security';

/**
 * WebAssembly Isolator. Runs wasm handlers in V8's wasm VM — the
 * strongest pure-JS sandbox: zero ambient authority. Wasm modules can
 * call only the host functions the isolator explicitly imports; no
 * `node:fs`, no `process.env`, no closures from the host.
 *
 * Capability mediation: host imports below. Modules opt in by declaring
 * them in their wasm import section. The host re-validates every
 * brokered op against `caps` before executing.
 *
 * --------------------------------------------------------------------
 * Calling convention (v1)
 * --------------------------------------------------------------------
 *
 * **Module exports** (required):
 *   - `memory: WebAssembly.Memory`
 *   - `alloc(size: i32) -> i32`
 *   - `<handler-name>(inputPtr: i32, inputLen: i32) -> i64`
 *     Return value packs `(outputPtr << 32) | outputLen`.
 *     Input + output are UTF-8 JSON.
 *
 * --------------------------------------------------------------------
 * Broker import surface (v1 — synchronous)
 * --------------------------------------------------------------------
 *
 * Wasm imports are synchronous from the module's perspective. Async
 * broker ops would break the type contract (the wasm side expects an
 * `i32` return). So the wasm broker uses **synchronous Node APIs**:
 * `readFileSync`, `writeFileSync`, `readdirSync`, `statSync`,
 * `spawnSync`. Network ops (`fetch`) have no safe sync equivalent in
 * Node and are intentionally NOT exposed under wasm — handlers that
 * need network should run under `worker` or `subprocess` isolators.
 *
 * Common ABI for every brokered import (i32 args + i32 return):
 *
 * ```
 * (inputPtr, inputLen, outPtrOut, outLenOut) -> i32
 * ```
 *
 * - `inputPtr/inputLen`: a UTF-8 string in memory describing the call's
 *   primary argument (file path / command name).
 * - `outPtrOut`, `outLenOut`: addresses where the host writes a
 *   `(resultPtr, resultLen)` pair as two i32s.
 * - Return: 0 on success, 1 on error. The result bytes at
 *   `(resultPtr, resultLen)` are the operation output (UTF-8 string,
 *   or for `read_file` the raw file contents) on success, or the
 *   error message bytes on failure.
 *
 * Ops whose payload doesn't fit "single input string + result bytes"
 * use a slightly extended ABI documented inline below.
 *
 * --------------------------------------------------------------------
 * What ships
 * --------------------------------------------------------------------
 *
 * - v1 calling convention, end-to-end (host marshals JSON → memory →
 *   handler → memory → JSON; tested with hand-encoded echo fixture).
 * - All five sync broker imports wired: read_file, write_file,
 *   readdir, stat, exec. Validate against caps; deny on out-of-scope.
 * - Zero ambient authority guaranteed by the wasm VM itself: modules
 *   without import declarations have no host-callable surface.
 *
 * **Authoring story.** Writing real wasm handlers requires a wasm
 * toolchain (AssemblyScript / Rust + wasm-bindgen / TinyGo). The
 * calling convention above is intentionally aligned with what those
 * toolchains produce by default. A wasm-authored handler recipe will
 * land alongside the first tool that actually adopts it.
 */

export interface WasmIsolatorOptions {
  /** Default wall-clock budget (ms) when caps.timeMs is omitted. */
  readonly defaultTimeMs?: number;
}

type WasmMemoryExports = {
  readonly memory: WebAssembly.Memory;
  readonly alloc: (size: number) => number;
  readonly [name: string]: WebAssembly.ExportValue;
};

const SUCCESS = 0;
const ERROR = 1;

/**
 * Hard ceiling on bytes the wasm broker will buffer or hand back across the
 * boundary in one op — mirrors `@moxxy/plugin-security`'s `MAX_BROKER_OUTPUT_BYTES`
 * (8 MB). Caps the handler's declared output region and the remote-module
 * download so a buggy/hostile module returning `outputLen=0xffffffff` (or a
 * gigabyte response) can't force a huge `TextDecoder`/`Buffer` allocation and
 * OOM the host before parsing.
 */
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/** Upper bound on the number of argv elements a brokered exec may carry. */
const MAX_EXEC_ARGV = 4096;

// Encoders/decoders are stateless and reusable; allocating a fresh one per
// broker call / string op (in a handler that loops over many ops) is pure waste.
const UTF8_DECODER = new TextDecoder();
const UTF8_ENCODER = new TextEncoder();

export function createWasmIsolator(opts: WasmIsolatorOptions = {}): Isolator {
  const defaultTimeMs = opts.defaultTimeMs ?? 60_000;

  return {
    name: 'wasm',
    strength: 'wasm',
    async run(call, _handler, caps, signal) {
      if (!call.moduleRef) {
        throw new Error(
          `[security:wasm] tool '${call.toolName}' has no handlerModule declared; ` +
            `wasm isolation requires a .wasm module URL.`,
        );
      }

      const verdict = checkAllCaps(call.input, caps, call.cwd);
      if (!verdict.ok) throw new Error(`[security:wasm] ${verdict.reason}`);

      const timeMs = caps.timeMs ?? defaultTimeMs;
      const abortError = (): Error =>
        new Error(`[security:wasm] tool '${call.toolName}' aborted`);

      // NOTE: wasm handler/broker execution is SYNCHRONOUS on the event loop
      // (the wasm VM call and `spawnSync` block it), so neither this timer nor
      // the abort listener can fire WHILE that synchronous work runs — they only
      // win the race when `invoke` yields at an `await`. Hard wall-clock/abort
      // enforcement against a runaway sync wasm loop requires running the module
      // in a terminable Worker thread (out of scope here); `caps.timeMs` is also
      // passed to `spawnSync` so a hung child is killed by the OS, not just here.
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      try {
        return await Promise.race([
          invoke(call, caps, signal, timeMs),
          new Promise<never>((_resolve, reject) => {
            if (signal.aborted) {
              reject(abortError());
              return;
            }
            timer = setTimeout(() => {
              reject(
                new Error(
                  `[security:wasm] tool '${call.toolName}' exceeded ${timeMs}ms budget`,
                ),
              );
            }, timeMs);
            // Don't keep the event loop alive solely for this timer; on the
            // success path `invoke` resolves first and the (uncleared-until-
            // finally) timer would otherwise delay a clean process exit.
            timer.unref?.();
            onAbort = (): void => reject(abortError());
            signal.addEventListener('abort', onAbort, { once: true });
          }),
        ]);
      } finally {
        // Always clear the timer and remove the abort listener — without this
        // the success path leaks one listener per call on a long-lived session
        // signal (eventually MaxListenersExceededWarning) and a 60s timer that
        // pins the event loop.
        if (timer) clearTimeout(timer);
        if (onAbort) signal.removeEventListener('abort', onAbort);
      }
    },
  };
}

async function invoke(
  call: IsolatedToolCall,
  caps: CapabilitySpec,
  signal: AbortSignal,
  timeMs: number,
): Promise<unknown> {
  const bytes = await fetchWasmBytes(call.moduleRef!.url, signal);
  const memoryHolder: MemoryHolder = { current: null };
  const env = buildWasmHostImports(memoryHolder, caps, call.cwd, timeMs);
  // BufferSource cast: TS5+ types Uint8Array as <ArrayBufferLike>
  // which includes SharedArrayBuffer; WebAssembly.compile wants a
  // non-shared ArrayBuffer. Our bytes always come from a non-shared
  // ArrayBuffer (fs.readFile / Buffer.from / fetch arrayBuffer).
  //
  // Frame compile/instantiate failures: corrupt or non-wasm bytes (e.g. a
  // server that serves an HTML error page instead of the module, a truncated
  // download, or a module importing a host symbol we don't supply) otherwise
  // surface as a bare `CompileError`/`LinkError` with no `[security:wasm]`
  // context. Degrade to an actionable error rather than leaking the raw trap.
  let instance: WebAssembly.Instance;
  try {
    const module = await WebAssembly.compile(bytes as unknown as BufferSource);
    instance = await WebAssembly.instantiate(module, { env });
  } catch (e) {
    throw new Error(
      `[security:wasm] failed to compile/instantiate module '${call.moduleRef!.url}': ` +
        `${(e as Error).message}`,
    );
  }
  const exports = instance.exports as WasmMemoryExports;
  if (!(exports.memory instanceof WebAssembly.Memory)) {
    throw new Error(`[security:wasm] module does not export 'memory'`);
  }
  memoryHolder.current = exports.memory;

  if (typeof exports.alloc !== 'function') {
    throw new Error(`[security:wasm] module does not export 'alloc(size: i32) -> i32'`);
  }
  // Route broker scratch through the module's own allocator so host writes
  // and the module's heap can never overlap (see MemoryHolder.alloc).
  memoryHolder.alloc = (size: number) => exports.alloc(size);
  const handler = exports[call.moduleRef!.export];
  if (typeof handler !== 'function') {
    throw new Error(
      `[security:wasm] export '${call.moduleRef!.export}' is ${typeof handler}, expected function`,
    );
  }

  const inputBytes = UTF8_ENCODER.encode(JSON.stringify(call.input));
  const inputPtr = exports.alloc(inputBytes.length);
  new Uint8Array(exports.memory.buffer, inputPtr, inputBytes.length).set(inputBytes);

  const packed = (handler as (a: number, b: number) => unknown)(inputPtr, inputBytes.length);
  // The handler must follow the (i32,i32)->i64 calling convention so the
  // (ptr<<32)|len result packs into one i64. A wasm export with the wrong
  // signature (returns i32, takes different arity) would otherwise reach the
  // `packed >> 32n` shift below and throw a cryptic "Cannot mix BigInt and
  // other types" TypeError — surface the real ABI violation instead.
  if (typeof packed !== 'bigint') {
    throw new Error(
      `[security:wasm] handler must return i64 (got ${typeof packed}); ` +
        `check the (i32,i32)->i64 calling convention`,
    );
  }
  const outputPtr = Number((packed >> 32n) & 0xffff_ffffn);
  const outputLen = Number(packed & 0xffff_ffffn);

  if (outputLen === 0) return undefined;
  // Validate the module-controlled (ptr,len) against the real buffer BEFORE
  // constructing the view: an out-of-range len makes `new Uint8Array` throw a
  // bare `RangeError: Invalid typed array length` with no context, and a
  // multi-hundred-MB len would force a huge decode allocation (memory-pressure
  // DoS). Frame both as actionable ABI errors and cap the size.
  if (outputLen > MAX_OUTPUT_BYTES) {
    throw new Error(
      `[security:wasm] handler returned oversized output (${outputLen} bytes > ${MAX_OUTPUT_BYTES} limit)`,
    );
  }
  const byteLength = exports.memory.buffer.byteLength;
  if (outputPtr < 0 || outputPtr + outputLen > byteLength) {
    throw new Error(
      `[security:wasm] handler returned out-of-range output region ` +
        `(ptr=${outputPtr}, len=${outputLen}, memory=${byteLength} bytes)`,
    );
  }
  const outputBytes = new Uint8Array(exports.memory.buffer, outputPtr, outputLen);
  const outputJson = UTF8_DECODER.decode(outputBytes);
  if (outputJson === '') return undefined;
  try {
    return JSON.parse(outputJson);
  } catch (e) {
    throw new Error(
      `[security:wasm] handler output is not valid JSON: ${(e as Error).message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Wasm host imports (synchronous broker)
// ---------------------------------------------------------------------------

interface MemoryHolder {
  current: WebAssembly.Memory | null;
  /**
   * The module's own `alloc(size) -> ptr` export, when available. Broker
   * scratch regions are obtained from it so host writes never collide with
   * the module's own heap (a non-trivial AssemblyScript/Rust heap easily
   * exceeds the first 64KiB page, where the fixed-base fallback would start
   * scribbling over live module data). When absent (e.g. unit tests that
   * construct a bare Memory), scratch falls back to a per-memory bump
   * allocator from a fixed base.
   */
  alloc?: ((size: number) => number) | null;
}

/**
 * Build the `env` import object for a wasm instance. Modules opt in
 * to each function by declaring it in their imports; modules that
 * don't import it have no host-callable surface for that op.
 *
 * Exported separately so the unit tests can exercise each bridge
 * without spinning up a real wasm instance.
 */
export function buildWasmHostImports(
  memoryHolder: MemoryHolder,
  caps: CapabilitySpec,
  cwd: string,
  defaultTimeMs = 60_000,
): WebAssembly.ModuleImports {
  const memOf = (): WebAssembly.Memory => {
    const m = memoryHolder.current;
    if (!m) throw new Error('[security:wasm] memory not bound');
    return m;
  };

  const readStr = (ptr: number, len: number): string => {
    return UTF8_DECODER.decode(new Uint8Array(memOf().buffer, ptr, len));
  };

  const sendBytes = (outPtrOut: number, outLenOut: number, bytes: Uint8Array): void => {
    // Prefer the module's own allocator (no collision with its heap); fall
    // back to the fixed-base bump allocator when no alloc is bound.
    const region =
      bytes.length === 0
        ? SCRATCH_BASE
        : memoryHolder.alloc
          ? memoryHolder.alloc(bytes.length)
          : reserveScratch(memOf(), bytes.length);
    if (bytes.length > 0) {
      // The `region` comes from the module's own `alloc` export (or the
      // bump-allocator fallback). Validate it lands inside linear memory BEFORE
      // constructing the view: a buggy/hostile `alloc` returning a negative or
      // out-of-range pointer would otherwise make `new Uint8Array(...)` throw a
      // bare `RangeError: Invalid typed array length/offset` with no
      // `[security:wasm]` framing — the same opaque-trap class already guarded
      // for the out-pointer pair in `writePtrPair`. Frame it as an actionable
      // ABI error instead.
      const byteLength = memOf().buffer.byteLength;
      if (!Number.isInteger(region) || region < 0 || region + bytes.length > byteLength) {
        throw new Error(
          `[security:wasm] module alloc returned an out-of-range scratch region ` +
            `(region=${region}, len=${bytes.length}, memory=${byteLength} bytes)`,
        );
      }
      new Uint8Array(memOf().buffer, region, bytes.length).set(bytes);
    }
    writePtrPair(memOf(), outPtrOut, outLenOut, region, bytes.length);
  };

  const sendStr = (outPtrOut: number, outLenOut: number, s: string): void => {
    sendBytes(outPtrOut, outLenOut, UTF8_ENCODER.encode(s));
  };

  const sendErr = (outPtrOut: number, outLenOut: number, message: string): number => {
    sendStr(outPtrOut, outLenOut, message);
    return ERROR;
  };

  return {
    /**
     * `broker_fs_read_file(pathPtr, pathLen, outPtrOut, outLenOut) -> i32`
     * Reads a file. Result bytes are the file contents.
     */
    broker_fs_read_file: (
      pathPtr: number,
      pathLen: number,
      outPtrOut: number,
      outLenOut: number,
    ): number => {
      const filePath = readStr(pathPtr, pathLen);
      let real: string;
      try {
        // Canonicalize + re-validate (symlink-free) so a symlink inside scope
        // can't escape to an out-of-scope target. Throws when out of scope.
        real = realpathInScope(filePath, caps, cwd, 'read', 'broker:fs.readFile');
      } catch (e) {
        return sendErr(outPtrOut, outLenOut, (e as Error).message);
      }
      try {
        const bytes = readFileSync(real);
        sendBytes(outPtrOut, outLenOut, new Uint8Array(bytes));
        return SUCCESS;
      } catch (e) {
        return sendErr(outPtrOut, outLenOut, (e as Error).message);
      }
    },

    /**
     * `broker_fs_write_file(pathPtr, pathLen, dataPtr, dataLen, outPtrOut, outLenOut) -> i32`
     *
     * Slightly extended ABI (6 args instead of 4) because the write
     * carries both a path string and a data payload, and — like every
     * other bridge — surfaces a descriptive error to the caller on
     * failure. On success no result bytes are produced (the host still
     * writes a zero-length `(0, 0)` pair to the out-pointers). On
     * cap-deny or IO error the out-pointer pair points at the error
     * message bytes. Returns 0 on success, 1 on error.
     */
    broker_fs_write_file: (
      pathPtr: number,
      pathLen: number,
      dataPtr: number,
      dataLen: number,
      outPtrOut: number,
      outLenOut: number,
    ): number => {
      const filePath = readStr(pathPtr, pathLen);
      // Cap-check BEFORE touching the payload: an out-of-scope path is a clean
      // deny, and a bogus `dataLen` shouldn't surface a RangeError that masks
      // the real (cap) failure. Canonicalize so a symlinked parent dir can't
      // smuggle the write out of scope.
      let real: string;
      try {
        real = realpathInScope(filePath, caps, cwd, 'write', 'broker:fs.writeFile');
      } catch (e) {
        return sendErr(outPtrOut, outLenOut, (e as Error).message);
      }
      // Read the payload as raw bytes — NOT through a UTF-8 round-trip, which
      // would lossily replace any non-UTF-8 byte with U+FFFD before it hits
      // disk. `.slice()` copies out of the live wasm buffer (which can be
      // detached/regrown later in the call). Mirrors read_file's byte fidelity.
      const data = new Uint8Array(memOf().buffer, dataPtr, dataLen).slice();
      try {
        mkdirSync(path.dirname(real), { recursive: true });
        writeFileSync(real, Buffer.from(data));
        writePtrPair(memOf(), outPtrOut, outLenOut, 0, 0);
        return SUCCESS;
      } catch (e) {
        return sendErr(outPtrOut, outLenOut, `[broker:fs.writeFile] ${(e as Error).message}`);
      }
    },

    /**
     * `broker_fs_readdir(pathPtr, pathLen, outPtrOut, outLenOut) -> i32`
     * Result bytes are entry names joined by `\n` (each is UTF-8).
     */
    broker_fs_readdir: (
      pathPtr: number,
      pathLen: number,
      outPtrOut: number,
      outLenOut: number,
    ): number => {
      const dirPath = readStr(pathPtr, pathLen);
      let real: string;
      try {
        real = realpathInScope(dirPath, caps, cwd, 'read', 'broker:fs.readdir');
      } catch (e) {
        return sendErr(outPtrOut, outLenOut, (e as Error).message);
      }
      try {
        const entries = readdirSync(real);
        sendStr(outPtrOut, outLenOut, entries.join('\n'));
        return SUCCESS;
      } catch (e) {
        return sendErr(outPtrOut, outLenOut, (e as Error).message);
      }
    },

    /**
     * `broker_fs_stat(pathPtr, pathLen, outPtrOut, outLenOut) -> i32`
     * Result bytes are JSON `{ size, mtimeMs, isFile, isDirectory }`.
     */
    broker_fs_stat: (
      pathPtr: number,
      pathLen: number,
      outPtrOut: number,
      outLenOut: number,
    ): number => {
      const filePath = readStr(pathPtr, pathLen);
      let real: string;
      try {
        real = realpathInScope(filePath, caps, cwd, 'read', 'broker:fs.stat');
      } catch (e) {
        return sendErr(outPtrOut, outLenOut, (e as Error).message);
      }
      try {
        const st = statSync(real);
        sendStr(
          outPtrOut,
          outLenOut,
          JSON.stringify({
            size: st.size,
            mtimeMs: st.mtimeMs,
            isFile: st.isFile(),
            isDirectory: st.isDirectory(),
          }),
        );
        return SUCCESS;
      } catch (e) {
        return sendErr(outPtrOut, outLenOut, (e as Error).message);
      }
    },

    /**
     * `broker_exec(cmdPtr, cmdLen, argvJsonPtr, argvJsonLen, outPtrOut, outLenOut) -> i32`
     *
     * Slightly extended ABI (6 args instead of 4) because exec needs
     * a structured argv. argv is a JSON-encoded `string[]`. Result
     * bytes are JSON `{ stdout, stderr, exitCode }`. spawnSync blocks
     * the event loop — acceptable inside a wasm broker call because
     * the wasm side is already blocking on the import return.
     */
    broker_exec: (
      cmdPtr: number,
      cmdLen: number,
      argvJsonPtr: number,
      argvJsonLen: number,
      outPtrOut: number,
      outLenOut: number,
    ): number => {
      if (!caps.subprocess) {
        return sendErr(
          outPtrOut,
          outLenOut,
          `[broker:exec] tool's capability spec does not include subprocess: true`,
        );
      }
      const command = readStr(cmdPtr, cmdLen);
      let argv: ReadonlyArray<string> = [];
      try {
        const json = readStr(argvJsonPtr, argvJsonLen);
        const parsed = JSON.parse(json) as unknown;
        if (!Array.isArray(parsed)) {
          return sendErr(outPtrOut, outLenOut, `[broker:exec] argv must be a JSON string[]`);
        }
        // Bound the argv before spawning: a module can hand over an arbitrarily
        // large array, and a structured/non-string element should surface as an
        // ABI error rather than being coerced to '[object Object]'.
        if (parsed.length > MAX_EXEC_ARGV) {
          return sendErr(
            outPtrOut,
            outLenOut,
            `[broker:exec] argv length ${parsed.length} exceeds the ${MAX_EXEC_ARGV} limit`,
          );
        }
        let totalArgvBytes = 0;
        for (const el of parsed) {
          if (typeof el !== 'string') {
            return sendErr(outPtrOut, outLenOut, `[broker:exec] argv elements must be strings`);
          }
          totalArgvBytes += el.length;
          if (totalArgvBytes > MAX_OUTPUT_BYTES) {
            return sendErr(outPtrOut, outLenOut, `[broker:exec] argv total size exceeds the limit`);
          }
        }
        argv = parsed as ReadonlyArray<string>;
      } catch (e) {
        return sendErr(outPtrOut, outLenOut, `[broker:exec] bad argv JSON: ${(e as Error).message}`);
      }
      const allowlist = caps.commands;
      if (allowlist && allowlist.length > 0) {
        const base = path.basename(command);
        if (!allowlist.includes(base) && !allowlist.includes(command)) {
          return sendErr(
            outPtrOut,
            outLenOut,
            `[broker:exec] command '${command}' is outside the tool's declared commands allowlist`,
          );
        }
      }
      try {
        const res = spawnSync(command, [...argv], {
          cwd,
          encoding: 'utf8',
          // Curate the child env through the tool's `caps.env` allowlist (or a
          // minimal default) instead of inheriting ALL of process.env — passing
          // no `env` would hand the child every API key/token/secret the host
          // holds. Mirrors the async broker's exec env curation.
          env: buildBrokerEnv(caps, undefined),
          // ALWAYS bound the child's wall clock: `spawnSync` blocks the event
          // loop, so without a timeout a hung command (with no caps.timeMs)
          // would wedge the host forever — the outer Promise.race can't fire
          // while this synchronous call runs. Fall back to the isolator's
          // default budget.
          timeout: caps.timeMs ?? defaultTimeMs,
          // Bound the buffered output to the async broker's 8 MB ceiling instead
          // of relying on Node's 1 MB default — and keep the cap in parity.
          maxBuffer: MAX_OUTPUT_BYTES,
        });
        // spawnSync swallows failures into `res.error` (ENOENT, ETIMEDOUT,
        // maxBuffer exceeded) while leaving status null and stdout/stderr empty.
        // Surface it so the wasm caller learns the command failed rather than
        // seeing a misleading empty success.
        if (res.error) {
          return sendErr(outPtrOut, outLenOut, `[broker:exec] ${res.error.message}`);
        }
        sendStr(
          outPtrOut,
          outLenOut,
          JSON.stringify({
            stdout: res.stdout ?? '',
            stderr: res.stderr ?? '',
            exitCode: res.status,
          }),
        );
        return SUCCESS;
      } catch (e) {
        return sendErr(outPtrOut, outLenOut, (e as Error).message);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Memory marshalling helpers (host side)
// ---------------------------------------------------------------------------

// Bump-pointer scratch allocator, keyed PER memory (i.e. per wasm invocation —
// each instantiation gets its own WebAssembly.Memory). A module-global offset
// here was a real bug: it persisted across invocations and only ever grew, so
// every later call started higher and forced unbounded memory.grow() / OOM.
const SCRATCH_BASE = 65536;
let scratchOffsets = new WeakMap<WebAssembly.Memory, number>();

function reserveScratch(memory: WebAssembly.Memory, size: number): number {
  const start = scratchOffsets.get(memory) ?? SCRATCH_BASE;
  const next = start + size;
  scratchOffsets.set(memory, next);
  const required = Math.ceil((next + 1) / 65536);
  const have = memory.buffer.byteLength / 65536;
  if (required > have) {
    // `memory.grow` throws if the memory has a `maximum` that the growth would
    // exceed, and returns -1 on failure. Either way, raise a framed OOM error
    // instead of letting an opaque trap propagate out of the synchronous import.
    let result: number;
    try {
      result = memory.grow(required - have);
    } catch (e) {
      throw new Error(`[security:wasm] scratch memory.grow failed: ${(e as Error).message}`);
    }
    if (result === -1) {
      throw new Error(`[security:wasm] scratch memory.grow failed (memory maximum reached)`);
    }
  }
  return start;
}

/**
 * Test-only helper to reset the scratch allocator between unit tests. State is
 * now per-memory, so a fresh memory already starts at the base; this just drops
 * the table for full isolation.
 */
export function _resetScratch(): void {
  scratchOffsets = new WeakMap();
}

function writePtrPair(
  memory: WebAssembly.Memory,
  outPtrOut: number,
  outLenOut: number,
  ptr: number,
  len: number,
): void {
  // The out-pointers come from the wasm module. `DataView.setUint32` already
  // bounds-checks (throwing RangeError on OOB), but validate up front so a
  // module that points the host at an out-of-range/negative address gets a
  // framed [security:wasm] error rather than an opaque trap.
  const byteLength = memory.buffer.byteLength;
  if (outPtrOut < 0 || outPtrOut + 4 > byteLength || outLenOut < 0 || outLenOut + 4 > byteLength) {
    throw new Error(
      `[security:wasm] broker out-pointer out of range ` +
        `(outPtrOut=${outPtrOut}, outLenOut=${outLenOut}, memory=${byteLength} bytes)`,
    );
  }
  const view = new DataView(memory.buffer);
  view.setUint32(outPtrOut, ptr, true);
  view.setUint32(outLenOut, len, true);
}

// ---------------------------------------------------------------------------
// Symlink-safe path scoping (synchronous port of the async broker)
// ---------------------------------------------------------------------------
//
// `pathInScope` (from @moxxy/plugin-security) is PURELY LEXICAL: it normalizes
// the string and matches it against the cap globs without ever touching the
// filesystem. That leaves a symlink escape — a path that lexically sits inside
// scope (`$cwd/link`) can point at `/etc/passwd` — plus a TOCTOU window. The
// async broker (broker.ts:realpathInScope) closes this by resolving the real
// path and re-validating it. Wasm imports are synchronous, so we mirror that
// logic here with `realpathSync`. Kept in lockstep with broker.ts; see the
// DRY follow-up to factor a shared `realpathInScopeSync` into plugin-security.

/**
 * Re-validate `filePath` against the declared fs scope AFTER resolving symlinks,
 * returning the canonical path the caller should hand to the syscall (so the op
 * runs on exactly what was validated). Throws a framed error when out of scope.
 */
function realpathInScope(
  filePath: string,
  caps: CapabilitySpec,
  cwd: string,
  mode: 'read' | 'write',
  label: string,
): string {
  // Lexical gate first (cheap; rejects obvious out-of-scope inputs).
  if (!pathInScope(filePath, caps.fs, cwd, mode)) {
    throw new Error(
      `[${label}] path '${filePath}' is outside the tool's declared fs.${mode} capability`,
    );
  }
  const abs = path.isAbsolute(filePath) ? path.normalize(filePath) : path.resolve(cwd, filePath);
  let real: string;
  try {
    real = realpathSync(abs);
  } catch {
    // Target doesn't exist yet (write/mkdir destination): canonicalize the
    // deepest existing ancestor so a symlinked parent dir can't smuggle the
    // op out of scope, while still allowing a brand-new leaf.
    real = realpathDeepestSync(abs);
  }
  // Fast path: realpath unchanged → the lexical check already vetted it.
  if (real === abs) return real;
  // The path traversed a symlink — re-validate the REAL location against the
  // CANONICALIZED scope roots. Canonicalizing both sides keeps benign system
  // symlinks (macOS `/var`→`/private/var`, `/tmp`→`/private/tmp`) from causing
  // false rejections, while a genuine escape canonicalizes to a root not under
  // any allowed scope and is rejected.
  const globs = mode === 'read' ? caps.fs?.read : caps.fs?.write;
  const allowed = canonicalScopeRootsSync(globs ?? [], cwd);
  if (!allowed.some((root) => isWithin(real, root))) {
    throw new Error(
      `[${label}] path '${filePath}' resolves (via symlink) to '${real}', ` +
        `outside the tool's declared fs.${mode} capability`,
    );
  }
  return real;
}

function canonicalScopeRootsSync(
  globs: ReadonlyArray<string>,
  cwd: string,
): ReadonlyArray<string> {
  const roots: string[] = [];
  for (const glob of globs) {
    // Reuse the canonical `$cwd`/`~`/relative expander from plugin-security
    // rather than a local copy: the local one accepted `$cwdEVIL` (no separator)
    // and didn't throw on an unset HOME, both of which could mis-derive the
    // scope root. One shared expander = one validated boundary.
    const expanded = expandHomeAndCwd(glob, cwd);
    const wildcard = expanded.search(/[*?[]/);
    if (wildcard === -1 && !expanded.endsWith(path.sep)) {
      // A wildcard-free pattern with no trailing separator denotes exactly ONE
      // path. Its scope root must be that exact path, canonicalized WITHOUT
      // following a symlink at its own final component — otherwise a single-file
      // cap like read:['/work/exact'] where '/work/exact' is itself a symlink
      // would resolve to (and thus admit) whatever it points at, AND taking the
      // parent dirname here would broaden the root to the whole parent directory.
      // Canonicalize the PARENT chain and re-append the leaf so a symlinked leaf's
      // realpath differs from this root and is rejected. (Parity with broker.ts.)
      const parent = path.dirname(expanded);
      const leaf = path.basename(expanded);
      let parentReal: string;
      try {
        parentReal = realpathSync(parent);
      } catch {
        parentReal = realpathDeepestSync(parent);
      }
      roots.push(path.join(parentReal, leaf));
      continue;
    }
    // Wildcarded pattern (or a literal dir written with a trailing sep): the
    // canonical root is the literal directory prefix the glob spans beneath.
    const literal = wildcard === -1 ? expanded : expanded.slice(0, wildcard);
    const base = literal.endsWith(path.sep) ? literal.slice(0, -1) : path.dirname(literal);
    const normalized = path.normalize(base || path.sep);
    try {
      roots.push(realpathSync(normalized));
    } catch {
      roots.push(realpathDeepestSync(normalized));
    }
  }
  return roots;
}

/** True when `child` is `root` itself or a descendant of it. */
function isWithin(child: string, root: string): boolean {
  if (child === root) return true;
  const withSep = root.endsWith(path.sep) ? root : root + path.sep;
  return child.startsWith(withSep);
}

/**
 * Canonicalize the deepest existing ancestor of `abs`, then re-join the
 * non-existent remainder, so a symlinked parent directory can't move a
 * write/mkdir out of scope.
 */
function realpathDeepestSync(abs: string): string {
  const parts = abs.split(path.sep);
  for (let i = parts.length; i > 0; i--) {
    const candidate = parts.slice(0, i).join(path.sep) || path.sep;
    try {
      const real = realpathSync(candidate);
      const remainder = parts.slice(i);
      return remainder.length ? path.join(real, ...remainder) : real;
    } catch {
      // ancestor doesn't exist either; keep walking up
    }
  }
  return abs;
}

// ---------------------------------------------------------------------------
// Module fetching
// ---------------------------------------------------------------------------

/**
 * Fetch wasm bytes from a `handlerModule` URL. Local schemes (`file:`, `data:`)
 * are always allowed; remote fetch is restricted to `https:` so a network MITM
 * can't swap the executable module bytes (plaintext `http:` is rejected). Every
 * scheme is capped at `MAX_OUTPUT_BYTES` so an oversized module (inline `data:`,
 * a huge local `.wasm`, or a remote response) can't force an unbounded
 * allocation; the remote download is additionally bound to the abort `signal`.
 *
 * NOTE: there is no subresource-integrity pin — `HandlerModuleRef` carries no
 * hash field — so a compromised/re-published https host can still serve hostile
 * bytes that execute inside the host process. See the needsFollowup note about
 * adding an `integrity` field to `HandlerModuleRef`.
 */
async function fetchWasmBytes(url: string, signal: AbortSignal): Promise<Uint8Array> {
  // Short-circuit an already-aborted call for EVERY scheme — `fetch` honors the
  // signal natively, but the local `data:`/`file:` decodes below would otherwise
  // still run their (potentially multi-MB) work before the outer Promise.race
  // discards the result. Bail before doing it.
  if (signal.aborted) {
    throw new Error('[security:wasm] module fetch aborted');
  }
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',');
    if (comma < 0) throw new Error(`[security:wasm] malformed data URL (no comma separator)`);
    const meta = url.slice(5, comma);
    const data = url.slice(comma + 1);
    let bytes: Buffer;
    try {
      bytes = meta.includes('base64')
        ? Buffer.from(data, 'base64')
        : // `decodeURIComponent` throws `URIError: URI malformed` on a bad
          // percent-escape (e.g. a truncated `%E0`); frame it instead of
          // leaking the bare URIError out of the isolator boundary.
          Buffer.from(decodeURIComponent(data), 'binary');
    } catch (e) {
      throw new Error(`[security:wasm] malformed data URL: ${(e as Error).message}`);
    }
    if (bytes.length > MAX_OUTPUT_BYTES) {
      throw new Error(
        `[security:wasm] inline data: module is ${bytes.length} bytes (> ${MAX_OUTPUT_BYTES} limit)`,
      );
    }
    return new Uint8Array(bytes);
  }
  if (url.startsWith('file:')) {
    let filePath: string;
    try {
      filePath = fileURLToPath(url);
    } catch (e) {
      throw new Error(`[security:wasm] malformed file: URL '${url}': ${(e as Error).message}`);
    }
    // Cap by the on-disk size BEFORE reading so a multi-gigabyte local `.wasm`
    // can't force an unbounded `readFile` allocation (parity with the remote
    // streamed cap; local paths previously skipped the limit entirely).
    let size: number;
    try {
      size = statSync(filePath).size;
    } catch (e) {
      throw new Error(`[security:wasm] cannot stat module '${filePath}': ${(e as Error).message}`);
    }
    if (size > MAX_OUTPUT_BYTES) {
      throw new Error(
        `[security:wasm] module at ${filePath} is ${size} bytes (> ${MAX_OUTPUT_BYTES} limit)`,
      );
    }
    return new Uint8Array(await fs.readFile(filePath));
  }
  if (!url.startsWith('https:')) {
    throw new Error(
      `[security:wasm] refusing to fetch module over a non-https scheme: '${url}' ` +
        `(use file:/data:/https: so module bytes can't be MITM'd)`,
    );
  }
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`[security:wasm] failed to fetch ${url}: ${res.status}`);
  }
  // Reject an oversized module by its declared length up front, then enforce the
  // cap while streaming (a lying/absent Content-Length can't smuggle past it).
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_OUTPUT_BYTES) {
    throw new Error(
      `[security:wasm] module at ${url} is ${declared} bytes (> ${MAX_OUTPUT_BYTES} limit)`,
    );
  }
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(await res.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_OUTPUT_BYTES) {
          throw new Error(
            `[security:wasm] module at ${url} exceeded the ${MAX_OUTPUT_BYTES}-byte limit`,
          );
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/** Default singleton. Use `createWasmIsolator({...})` to tune. */
export const wasmIsolator: Isolator = createWasmIsolator();

/**
 * Auto-discovery entry: a user-installed copy registers the isolator via
 * `PluginSpec.isolators`. Inert until opted into with `security.isolator: 'wasm'`.
 */
const plugin: Plugin = definePlugin({
  name: '@moxxy/isolator-wasm',
  isolators: [wasmIsolator],
});
export default plugin;
