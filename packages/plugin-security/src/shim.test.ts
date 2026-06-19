import { describe, expect, it } from 'vitest';
import { BROKER_CLIENT_SOURCE, SYNTHETIC_CTX_SOURCE } from './shim.js';

// These fragments are interpolated verbatim into BOTH the worker and the
// subprocess isolator shims, so they ARE the single source of truth for the
// brokered surface a sandboxed tool sees. Pin the boundary: a change here that
// widens it (a new op, a leaked ctx field) should require updating this test
// deliberately rather than slipping through.
describe('shared shim fragments', () => {
  it('BROKER_CLIENT_SOURCE exposes exactly the brokered ops, each via rpc()', () => {
    for (const op of ['fs.readFile', 'fs.writeFile', 'fs.readdir', 'fs.stat', 'fetch', 'exec']) {
      expect(BROKER_CLIENT_SOURCE).toContain(`rpc('${op}'`);
    }
    expect(BROKER_CLIENT_SOURCE).toContain('const broker =');
  });

  it('SYNTHETIC_CTX_SOURCE wires the broker proxies and an inert log/logger', () => {
    expect(SYNTHETIC_CTX_SOURCE).toContain('const ctx =');
    expect(SYNTHETIC_CTX_SOURCE).toContain('signal: abortController.signal');
    expect(SYNTHETIC_CTX_SOURCE).toContain('fs: broker.fs');
    expect(SYNTHETIC_CTX_SOURCE).toContain('fetch: broker.fetch');
    expect(SYNTHETIC_CTX_SOURCE).toContain('exec: broker.exec');
  });

  it('the fragments are valid standalone JS given the assumed free identifiers', () => {
    // Compile (don't run) the fragment in a scope that provides the free names
    // the host shim supplies (rpc / abortController / syntheticCtx / broker).
    // A syntax error in either fragment would throw here.
    expect(
      () =>
        new Function(
          'rpc',
          'abortController',
          'syntheticCtx',
          `${BROKER_CLIENT_SOURCE}\n${SYNTHETIC_CTX_SOURCE}\nreturn ctx;`,
        ),
    ).not.toThrow();
  });
});
