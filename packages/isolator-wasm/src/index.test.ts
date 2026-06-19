/**
 * Wasm isolator tests with the v1 calling convention (input/output
 * marshalling via linear memory + alloc/handler).
 *
 * The test fixture is hand-encoded raw wasm (~80 bytes) implementing
 * an `echo` handler: it accepts an `(inputPtr, inputLen)` pair and
 * returns the same `(inputPtr, inputLen)` packed into an i64. The host
 * marshals input JSON in, reads the same bytes out, parses, and we
 * assert round-trip equality.
 *
 * This proves:
 *  - The v1 calling convention works end-to-end.
 *  - The wasm VM correctly receives and returns 64-bit pointers.
 *  - The host's memory marshalling (encode JSON → allocator → memory
 *    write → handler call → memory read → JSON decode) is correct.
 *  - Zero ambient authority: the module has no imports.
 *
 * Broker integration from wasm is documented as a known gap — wasm
 * imports are synchronous from the module's perspective, but broker
 * ops are async. Closing the gap needs JSPI (V8 wasm/JS Promise
 * Integration) or a sync-broker variant. The host imports are wired
 * and ready; the wasm side just can't call them from sync code yet.
 */
import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import type { IsolatedToolCall } from '@moxxy/sdk';
import { createWasmIsolator } from './index.js';

// Hand-encoded WebAssembly v1.0 module implementing v1 calling
// convention echo (verified byte-by-byte against the wasm 1.0 spec):
//
//   (module
//     (memory (export "memory") 1)
//     (func (export "alloc") (param i32) (result i32)
//       i32.const 1024)
//     (func (export "echo") (param i32) (param i32) (result i64)
//       local.get 0  i64.extend_i32_u  i64.const 32  i64.shl
//       local.get 1  i64.extend_i32_u  i64.or))
//
// echo packs (inputPtr, inputLen) → (inputPtr << 32) | inputLen.
// Since echo returns the same region as input, the host reads back the
// same bytes it wrote — the calling-convention test.
//
// prettier-ignore
const ECHO_WASM = new Uint8Array([
  // magic + version
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  // type section: 2 types
  0x01, 0x0c, 0x02,
    0x60, 0x01, 0x7f, 0x01, 0x7f,                // 0: (i32) -> i32
    0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7e,          // 1: (i32, i32) -> i64
  // function section: 2 functions
  0x03, 0x03, 0x02, 0x00, 0x01,
  // memory section: 1 memory, min 1 page
  0x05, 0x03, 0x01, 0x00, 0x01,
  // export section: memory, alloc, echo
  0x07, 0x19, 0x03,
    0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00,
    0x05, 0x61, 0x6c, 0x6c, 0x6f, 0x63, 0x00, 0x00,
    0x04, 0x65, 0x63, 0x68, 0x6f, 0x00, 0x01,
  // code section
  0x0a, 0x14, 0x02,
    // alloc: i32.const 1024, end
    0x05, 0x00, 0x41, 0x80, 0x08, 0x0b,
    // echo: local.get 0; i64.extend_i32_u; i64.const 32; i64.shl;
    //       local.get 1; i64.extend_i32_u; i64.or; end
    0x0c, 0x00, 0x20, 0x00, 0xad, 0x42, 0x20, 0x86, 0x20, 0x01, 0xad, 0x84, 0x0b,
]);

const ECHO_DATA_URL =
  'data:application/wasm;base64,' + Buffer.from(ECHO_WASM).toString('base64');

// Hand-encoded module whose `bad` export VIOLATES the (i32,i32)->i64 calling
// convention: it returns i32 instead of i64. The host expects a packed i64
// `(ptr<<32)|len`; calling a non-bigint-returning handler must surface a clear
// ABI error rather than a cryptic "Cannot mix BigInt" TypeError at `>> 32n`.
//
//   (module
//     (memory (export "memory") 1)
//     (func (export "alloc") (param i32) (result i32) i32.const 1024)
//     (func (export "bad")   (param i32) (param i32) (result i32) i32.const 0))
//
// prettier-ignore
const BAD_RETURN_WASM = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x0c, 0x02,
    0x60, 0x01, 0x7f, 0x01, 0x7f,                // 0: (i32) -> i32
    0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f,          // 1: (i32, i32) -> i32  <- wrong
  0x03, 0x03, 0x02, 0x00, 0x01,
  0x05, 0x03, 0x01, 0x00, 0x01,
  0x07, 0x18, 0x03,
    0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00,
    0x05, 0x61, 0x6c, 0x6c, 0x6f, 0x63, 0x00, 0x00,
    0x03, 0x62, 0x61, 0x64, 0x00, 0x01,
  0x0a, 0x0c, 0x02,
    0x05, 0x00, 0x41, 0x80, 0x08, 0x0b,          // alloc: i32.const 1024, end
    0x04, 0x00, 0x41, 0x00, 0x0b,                // bad:   i32.const 0, end
]);

const BAD_RETURN_DATA_URL =
  'data:application/wasm;base64,' + Buffer.from(BAD_RETURN_WASM).toString('base64');

const baseCall = (
  exportName: string,
  input: unknown,
  over: Partial<IsolatedToolCall> = {},
): IsolatedToolCall => ({
  toolName: 'wasm-test',
  input,
  callId: 'c1',
  sessionId: 's1',
  turnId: 't1',
  cwd: '/work',
  moduleRef: { url: ECHO_DATA_URL, export: exportName },
  ...over,
});

describe('wasmIsolator v1 calling convention', () => {
  it('marshals JSON input → memory → handler → memory → JSON output', async () => {
    const iso = createWasmIsolator();
    const out = await iso.run(
      baseCall('echo', { msg: 'hello-wasm', n: 42 }),
      async () => 'unused',
      {},
      new AbortController().signal,
    );
    expect(out).toEqual({ msg: 'hello-wasm', n: 42 });
  });

  it('round-trips nested JSON values', async () => {
    const iso = createWasmIsolator();
    const input = { a: [1, 2, 3], b: { c: 'nested', d: null }, e: true };
    const out = await iso.run(
      baseCall('echo', input),
      async () => 'unused',
      {},
      new AbortController().signal,
    );
    expect(out).toEqual(input);
  });

  it('throws when the handler export is missing', async () => {
    const iso = createWasmIsolator();
    await expect(
      iso.run(
        baseCall('not_a_real_export', {}),
        async () => 'unused',
        {},
        new AbortController().signal,
      ),
    ).rejects.toThrow(/expected function/);
  });

  it('rejects with an actionable ABI error when the handler returns i32 not i64', async () => {
    const iso = createWasmIsolator();
    await expect(
      iso.run(
        baseCall('bad', {}, { moduleRef: { url: BAD_RETURN_DATA_URL, export: 'bad' } }),
        async () => 'unused',
        {},
        new AbortController().signal,
      ),
    ).rejects.toThrow(/must return i64.*\(i32,i32\)->i64 calling convention/s);
  });

  it('denies when moduleRef is missing', async () => {
    const iso = createWasmIsolator();
    await expect(
      iso.run(
        baseCall('echo', {}, { moduleRef: undefined }),
        async () => 'unused',
        {},
        new AbortController().signal,
      ),
    ).rejects.toThrow(/no handlerModule declared/);
  });

  it('honors input-level cap pre-flight', async () => {
    const iso = createWasmIsolator();
    await expect(
      iso.run(
        baseCall('echo', { file_path: '/etc/passwd' }),
        async () => 'unused',
        { fs: { read: ['$cwd/**'] } },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/outside the tool's declared fs capability/);
  });

  it('honors an external abort', async () => {
    const iso = createWasmIsolator({ defaultTimeMs: 10_000 });
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      iso.run(
        baseCall('echo', {}),
        async () => 'unused',
        {},
        ctrl.signal,
      ),
    ).rejects.toThrow(/aborted/);
  });

  it('module has zero ambient authority (boundary baseline)', async () => {
    // The echo module imports nothing. Even if it tried, V8's wasm VM
    // raises a LinkError when imports are declared but not supplied.
    // Our host supplies a full broker import surface, so any module
    // that *opts in* gets brokered access — but ECHO doesn't import
    // anything, so it can't reach the host even by accident.
    const iso = createWasmIsolator();
    const out = await iso.run(
      baseCall('echo', { proof: 'cannot-touch-host' }),
      async () => 'unused',
      {},
      new AbortController().signal,
    );
    expect(out).toEqual({ proof: 'cannot-touch-host' });
  });
});

describe('wasmIsolator module fetch + compile failure paths', () => {
  it('frames a CompileError on non-wasm / corrupt bytes (degrades, no bare trap)', async () => {
    // A server serving an HTML error page (or a truncated download) instead of
    // a .wasm module produces a bare V8 CompileError ("expected magic word").
    // The isolator must frame it with [security:wasm] context.
    const garbage =
      'data:application/wasm;base64,' + Buffer.from('<html>not wasm</html>').toString('base64');
    const iso = createWasmIsolator();
    await expect(
      iso.run(
        baseCall('echo', {}, { moduleRef: { url: garbage, export: 'echo' } }),
        async () => 'unused',
        {},
        new AbortController().signal,
      ),
    ).rejects.toThrow(/\[security:wasm\] failed to compile\/instantiate/);
  });

  it('frames a malformed data: URL (missing comma) instead of leaking a raw error', async () => {
    const iso = createWasmIsolator();
    await expect(
      iso.run(
        baseCall('echo', {}, { moduleRef: { url: 'data:application/wasm;base64', export: 'echo' } }),
        async () => 'unused',
        {},
        new AbortController().signal,
      ),
    ).rejects.toThrow(/\[security:wasm\] malformed data URL/);
  });

  it('frames a malformed percent-escape in a non-base64 data: URL (no bare URIError)', async () => {
    // `decodeURIComponent('%E0')` throws URIError: URI malformed; it must be
    // caught and re-framed rather than escaping the isolator boundary.
    const iso = createWasmIsolator();
    await expect(
      iso.run(
        baseCall('echo', {}, { moduleRef: { url: 'data:application/wasm,%E0', export: 'echo' } }),
        async () => 'unused',
        {},
        new AbortController().signal,
      ),
    ).rejects.toThrow(/\[security:wasm\] malformed data URL/);
  });

  it('rejects an oversized inline data: module before allocating it', async () => {
    // Build a data: URL whose decoded length exceeds the 8 MB cap. The bytes
    // are never even a valid module — the size guard must trip first, proving
    // the cap is enforced for local schemes (not just the remote stream).
    const big = Buffer.alloc(9 * 1024 * 1024, 0x41); // 9 MB of 'A'
    const url = 'data:application/wasm;base64,' + big.toString('base64');
    const iso = createWasmIsolator();
    await expect(
      iso.run(
        baseCall('echo', {}, { moduleRef: { url, export: 'echo' } }),
        async () => 'unused',
        {},
        new AbortController().signal,
      ),
    ).rejects.toThrow(/inline data: module is \d+ bytes \(> \d+ limit\)/);
  });

  it('refuses a plaintext http: module URL (MITM-able executable bytes)', async () => {
    const iso = createWasmIsolator();
    await expect(
      iso.run(
        baseCall('echo', {}, { moduleRef: { url: 'http://evil.example/m.wasm', export: 'echo' } }),
        async () => 'unused',
        {},
        new AbortController().signal,
      ),
    ).rejects.toThrow(/refusing to fetch module over a non-https scheme/);
  });

  it('short-circuits an already-aborted call before decoding a local data: module', async () => {
    // An already-aborted signal must bail before the (potentially multi-MB)
    // local decode runs — parity with the https path which threads the signal.
    const iso = createWasmIsolator({ defaultTimeMs: 10_000 });
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      iso.run(
        baseCall('echo', {}),
        async () => 'unused',
        {},
        ctrl.signal,
      ),
    ).rejects.toThrow(/aborted/);
  });
});
