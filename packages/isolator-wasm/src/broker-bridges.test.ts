/**
 * Unit tests for the synchronous wasm broker bridges.
 *
 * The bridges (`broker_fs_read_file` and friends) are functions
 * exposed to wasm modules as imports. They have the wasm calling
 * shape `(inputPtr, inputLen, [...,] outPtrOut, outLenOut) -> i32`,
 * reading inputs from a `WebAssembly.Memory` and writing results
 * back to it.
 *
 * Testing them via a real wasm module would require hand-encoding
 * modules that import each function, which is hundreds of bytes of
 * hand-assembled wasm bytecode per op. Instead we construct a fake
 * `WebAssembly.Memory` and call the bridges directly — same code
 * path, same memory access, no wasm bytecode needed.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { promises as fs, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CapabilitySpec } from '@moxxy/sdk';
import { buildWasmHostImports, _resetScratch } from './index.js';

function makeMemory(): WebAssembly.Memory {
  return new WebAssembly.Memory({ initial: 2 });
}

function writeStr(mem: WebAssembly.Memory, ptr: number, s: string): number {
  const bytes = new TextEncoder().encode(s);
  new Uint8Array(mem.buffer, ptr, bytes.length).set(bytes);
  return bytes.length;
}

function readResult(mem: WebAssembly.Memory, outPtrOut: number, outLenOut: number): string {
  const view = new DataView(mem.buffer);
  const ptr = view.getUint32(outPtrOut, true);
  const len = view.getUint32(outLenOut, true);
  return new TextDecoder().decode(new Uint8Array(mem.buffer, ptr, len));
}

interface Setup {
  memory: WebAssembly.Memory;
  imports: WebAssembly.ModuleImports;
  outPtrOut: number;
  outLenOut: number;
}

function setupBridges(caps: CapabilitySpec, cwd = '/tmp'): Setup {
  _resetScratch();
  const memory = makeMemory();
  const imports = buildWasmHostImports({ current: memory }, caps, cwd);
  return { memory, imports, outPtrOut: 32, outLenOut: 36 };
}

describe('wasm broker: broker_fs_read_file', () => {
  it('reads when in scope', async () => {
    const tmp = path.join(os.tmpdir(), `wasm-bridge-read-${Date.now()}.txt`);
    await fs.writeFile(tmp, 'hello-wasm-bridge');
    try {
      const { memory, imports, outPtrOut, outLenOut } = setupBridges({
        fs: { read: [`${os.tmpdir()}/**`] },
      });
      const pathPtr = 128;
      const pathLen = writeStr(memory, pathPtr, tmp);
      const rc = (imports.broker_fs_read_file as (...args: number[]) => number)(
        pathPtr,
        pathLen,
        outPtrOut,
        outLenOut,
      );
      expect(rc).toBe(0);
      expect(readResult(memory, outPtrOut, outLenOut)).toBe('hello-wasm-bridge');
    } finally {
      await fs.unlink(tmp);
    }
  });

  it('denies out-of-scope reads with code 1 + error message', () => {
    const { memory, imports, outPtrOut, outLenOut } = setupBridges({
      fs: { read: ['/tmp/**'] },
    });
    const pathPtr = 128;
    const pathLen = writeStr(memory, pathPtr, '/etc/passwd');
    const rc = (imports.broker_fs_read_file as (...args: number[]) => number)(
      pathPtr,
      pathLen,
      outPtrOut,
      outLenOut,
    );
    expect(rc).toBe(1);
    expect(readResult(memory, outPtrOut, outLenOut)).toMatch(/fs\.read capability/);
  });
});

describe('wasm broker: broker_fs_write_file', () => {
  it('writes when in scope', async () => {
    const tmp = path.join(os.tmpdir(), `wasm-bridge-write-${Date.now()}.txt`);
    try {
      const { memory, imports, outPtrOut, outLenOut } = setupBridges({
        fs: { write: [`${os.tmpdir()}/**`] },
      });
      const pathPtr = 128;
      const pathLen = writeStr(memory, pathPtr, tmp);
      const dataPtr = 1024;
      const dataLen = writeStr(memory, dataPtr, 'wasm-wrote-this');
      const rc = (imports.broker_fs_write_file as (...args: number[]) => number)(
        pathPtr,
        pathLen,
        dataPtr,
        dataLen,
        outPtrOut,
        outLenOut,
      );
      expect(rc).toBe(0);
      // Success yields a zero-length result pair (no diagnostics).
      expect(readResult(memory, outPtrOut, outLenOut)).toBe('');
      expect(await fs.readFile(tmp, 'utf8')).toBe('wasm-wrote-this');
    } finally {
      await fs.unlink(tmp).catch(() => undefined);
    }
  });

  it('writes arbitrary non-UTF-8 bytes verbatim (no lossy UTF-8 round-trip)', async () => {
    const tmp = path.join(os.tmpdir(), `wasm-bridge-write-bin-${Date.now()}.bin`);
    try {
      const { memory, imports, outPtrOut, outLenOut } = setupBridges({
        fs: { write: [`${os.tmpdir()}/**`] },
      });
      const pathPtr = 128;
      const pathLen = writeStr(memory, pathPtr, tmp);
      // 0x80 / 0xFF are not valid standalone UTF-8 — a TextDecoder round-trip
      // would replace them with U+FFFD (0xEF 0xBF 0xBD) and corrupt the file.
      const payload = new Uint8Array([0x00, 0x80, 0xff, 0x41, 0xfe]);
      const dataPtr = 2048;
      new Uint8Array(memory.buffer, dataPtr, payload.length).set(payload);
      const rc = (imports.broker_fs_write_file as (...args: number[]) => number)(
        pathPtr,
        pathLen,
        dataPtr,
        payload.length,
        outPtrOut,
        outLenOut,
      );
      expect(rc).toBe(0);
      const onDisk = new Uint8Array(await fs.readFile(tmp));
      expect(Array.from(onDisk)).toEqual(Array.from(payload));
    } finally {
      await fs.unlink(tmp).catch(() => undefined);
    }
  });

  it('denies out-of-scope writes with code 1 + error message', () => {
    const { memory, imports, outPtrOut, outLenOut } = setupBridges({
      fs: { write: ['/tmp/**'] },
    });
    const pathPtr = 128;
    const pathLen = writeStr(memory, pathPtr, '/etc/should-fail');
    const dataPtr = 1024;
    const dataLen = writeStr(memory, dataPtr, 'nope');
    const rc = (imports.broker_fs_write_file as (...args: number[]) => number)(
      pathPtr,
      pathLen,
      dataPtr,
      dataLen,
      outPtrOut,
      outLenOut,
    );
    expect(rc).toBe(1);
    expect(readResult(memory, outPtrOut, outLenOut)).toMatch(/fs\.write capability/);
  });

  it('surfaces a descriptive IO error on a failed in-scope write', () => {
    // In scope per caps, but the path is a directory that already exists,
    // so writeFileSync raises EISDIR. The caller must see the reason, not a
    // bare code 1.
    const dir = os.tmpdir();
    const { memory, imports, outPtrOut, outLenOut } = setupBridges({
      fs: { write: [`${os.tmpdir()}/**`] },
    });
    const pathPtr = 128;
    const pathLen = writeStr(memory, pathPtr, dir);
    const dataPtr = 1024;
    const dataLen = writeStr(memory, dataPtr, 'nope');
    const rc = (imports.broker_fs_write_file as (...args: number[]) => number)(
      pathPtr,
      pathLen,
      dataPtr,
      dataLen,
      outPtrOut,
      outLenOut,
    );
    expect(rc).toBe(1);
    const message = readResult(memory, outPtrOut, outLenOut);
    expect(message).toMatch(/\[broker:fs\.writeFile\]/);
    expect(message.length).toBeGreaterThan(0);
    // Carries the underlying errno reason rather than swallowing it.
    expect(message).toMatch(/EISDIR|illegal operation|directory/i);
  });
});

describe('wasm broker: broker_fs_readdir', () => {
  it('lists when in scope', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wasm-bridge-readdir-'));
    try {
      await fs.writeFile(path.join(dir, 'a.txt'), 'a');
      await fs.writeFile(path.join(dir, 'b.txt'), 'b');
      const { memory, imports, outPtrOut, outLenOut } = setupBridges({
        fs: { read: [`${os.tmpdir()}/**`] },
      });
      const pathPtr = 128;
      const pathLen = writeStr(memory, pathPtr, dir);
      const rc = (imports.broker_fs_readdir as (...args: number[]) => number)(
        pathPtr,
        pathLen,
        outPtrOut,
        outLenOut,
      );
      expect(rc).toBe(0);
      const entries = readResult(memory, outPtrOut, outLenOut).split('\n').sort();
      expect(entries).toEqual(['a.txt', 'b.txt']);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('denies out-of-scope readdir', () => {
    const { memory, imports, outPtrOut, outLenOut } = setupBridges({
      fs: { read: ['/tmp/**'] },
    });
    const pathPtr = 128;
    const pathLen = writeStr(memory, pathPtr, '/etc');
    const rc = (imports.broker_fs_readdir as (...args: number[]) => number)(
      pathPtr,
      pathLen,
      outPtrOut,
      outLenOut,
    );
    expect(rc).toBe(1);
  });
});

describe('wasm broker: broker_fs_stat', () => {
  it('returns JSON stat when in scope', () => {
    const tmp = path.join(os.tmpdir(), `wasm-bridge-stat-${Date.now()}.txt`);
    writeFileSync(tmp, 'abc');
    try {
      const { memory, imports, outPtrOut, outLenOut } = setupBridges({
        fs: { read: [`${os.tmpdir()}/**`] },
      });
      const pathPtr = 128;
      const pathLen = writeStr(memory, pathPtr, tmp);
      const rc = (imports.broker_fs_stat as (...args: number[]) => number)(
        pathPtr,
        pathLen,
        outPtrOut,
        outLenOut,
      );
      expect(rc).toBe(0);
      const result = JSON.parse(readResult(memory, outPtrOut, outLenOut)) as {
        size: number;
        isFile: boolean;
      };
      expect(result.size).toBe(3);
      expect(result.isFile).toBe(true);
    } finally {
      void fs.unlink(tmp).catch(() => undefined);
    }
  });
});

describe('wasm broker: broker_exec', () => {
  it('denies when subprocess cap is not granted', () => {
    const { memory, imports, outPtrOut, outLenOut } = setupBridges({});
    const cmdPtr = 128;
    const cmdLen = writeStr(memory, cmdPtr, '/bin/echo');
    const argvPtr = 1024;
    const argvLen = writeStr(memory, argvPtr, JSON.stringify(['hi']));
    const rc = (imports.broker_exec as (...args: number[]) => number)(
      cmdPtr,
      cmdLen,
      argvPtr,
      argvLen,
      outPtrOut,
      outLenOut,
    );
    expect(rc).toBe(1);
    expect(readResult(memory, outPtrOut, outLenOut)).toMatch(/subprocess: true/);
  });

  it('runs when subprocess cap is granted', () => {
    const { memory, imports, outPtrOut, outLenOut } = setupBridges({ subprocess: true });
    const cmdPtr = 128;
    const cmdLen = writeStr(memory, cmdPtr, '/bin/echo');
    const argvPtr = 1024;
    const argvLen = writeStr(memory, argvPtr, JSON.stringify(['hello-wasm-exec']));
    const rc = (imports.broker_exec as (...args: number[]) => number)(
      cmdPtr,
      cmdLen,
      argvPtr,
      argvLen,
      outPtrOut,
      outLenOut,
    );
    expect(rc).toBe(0);
    const result = JSON.parse(readResult(memory, outPtrOut, outLenOut)) as {
      stdout: string;
      exitCode: number | null;
    };
    expect(result.stdout).toContain('hello-wasm-exec');
    expect(result.exitCode).toBe(0);
  });

  it('honors commands allowlist (deny)', () => {
    const { memory, imports, outPtrOut, outLenOut } = setupBridges({
      subprocess: true,
      commands: ['echo'],
    });
    const cmdPtr = 128;
    const cmdLen = writeStr(memory, cmdPtr, '/bin/cat');
    const argvPtr = 1024;
    const argvLen = writeStr(memory, argvPtr, JSON.stringify(['/etc/hosts']));
    const rc = (imports.broker_exec as (...args: number[]) => number)(
      cmdPtr,
      cmdLen,
      argvPtr,
      argvLen,
      outPtrOut,
      outLenOut,
    );
    expect(rc).toBe(1);
    expect(readResult(memory, outPtrOut, outLenOut)).toMatch(/commands allowlist/);
  });
});

describe('wasm broker: scratch coordination with module allocator', () => {
  it('obtains result scratch from the module allocator (no fixed-base collision)', async () => {
    // Simulate a module whose own heap has already grown past the first
    // 64KiB page: its alloc() hands out monotonically increasing addresses
    // starting well above SCRATCH_BASE (65536). If the host ignored this and
    // bump-allocated from the fixed base, its writes would clobber the
    // module's live heap. Asserting the result lands at the allocator's
    // address proves host scratch is routed through the module's allocator.
    const tmp = path.join(os.tmpdir(), `wasm-bridge-scratch-${Date.now()}.txt`);
    await fs.writeFile(tmp, 'coordinated-scratch');
    try {
      _resetScratch();
      const memory = new WebAssembly.Memory({ initial: 4 }); // 4 pages = 256KiB
      let nextAlloc = 70_000; // past SCRATCH_BASE
      const allocAddrs: number[] = [];
      const alloc = (size: number): number => {
        const addr = nextAlloc;
        allocAddrs.push(addr);
        nextAlloc += size;
        return addr;
      };
      const imports = buildWasmHostImports({ current: memory, alloc }, {
        fs: { read: [`${os.tmpdir()}/**`] },
      }, '/tmp');
      const outPtrOut = 32;
      const outLenOut = 36;
      const pathPtr = 128;
      const pathLen = writeStr(memory, pathPtr, tmp);
      const rc = (imports.broker_fs_read_file as (...args: number[]) => number)(
        pathPtr,
        pathLen,
        outPtrOut,
        outLenOut,
      );
      expect(rc).toBe(0);
      // The result must have been written at the module-allocated address,
      // NOT at the fixed SCRATCH_BASE.
      const resultPtr = new DataView(memory.buffer).getUint32(outPtrOut, true);
      expect(allocAddrs).toContain(resultPtr);
      expect(resultPtr).toBeGreaterThanOrEqual(70_000);
      expect(readResult(memory, outPtrOut, outLenOut)).toBe('coordinated-scratch');
    } finally {
      await fs.unlink(tmp).catch(() => undefined);
    }
  });
});

describe('wasm broker: import surface', () => {
  it('exposes the documented op set', () => {
    const { imports } = setupBridges({});
    expect(Object.keys(imports).sort()).toEqual([
      'broker_exec',
      'broker_fs_read_file',
      'broker_fs_readdir',
      'broker_fs_stat',
      'broker_fs_write_file',
    ]);
  });

  it('does NOT expose broker_fetch (sync http isn\'t safe in Node)', () => {
    const { imports } = setupBridges({});
    expect(imports.broker_fetch).toBeUndefined();
  });
});

beforeEach(() => {
  _resetScratch();
});
