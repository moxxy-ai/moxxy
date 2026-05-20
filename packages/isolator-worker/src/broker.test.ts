import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { handleBrokerRequest, type BrokerRequest } from './broker.js';

const req = (op: string, args: unknown[], id = 1): BrokerRequest =>
  ({ type: 'broker-request', id, op: op as BrokerRequest['op'], args });

describe('broker: fs.readFile', () => {
  it('reads when path is in scope', async () => {
    const tmp = path.join(os.tmpdir(), `moxxy-broker-${Date.now()}.txt`);
    await fs.writeFile(tmp, 'hello broker');
    try {
      const res = await handleBrokerRequest(
        req('fs.readFile', [tmp]),
        {
          caps: { fs: { read: [`${os.tmpdir()}/**`] } },
          cwd: '/work',
          signal: new AbortController().signal,
        },
      );
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value).toBe('hello broker');
    } finally {
      await fs.unlink(tmp);
    }
  });

  it('denies when path is out of scope', async () => {
    const res = await handleBrokerRequest(
      req('fs.readFile', ['/etc/passwd']),
      {
        caps: { fs: { read: ['$cwd/**'] } },
        cwd: '/work',
        signal: new AbortController().signal,
      },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errorMessage).toMatch(/outside the tool's declared fs.read capability/);
    }
  });

  it('denies when no fs cap is declared', async () => {
    const res = await handleBrokerRequest(
      req('fs.readFile', ['/tmp/anything']),
      {
        caps: {},
        cwd: '/work',
        signal: new AbortController().signal,
      },
    );
    expect(res.ok).toBe(false);
  });

  it('rejects malformed args', async () => {
    const res = await handleBrokerRequest(
      req('fs.readFile', [123]),
      { caps: { fs: { read: ['/**'] } }, cwd: '/work', signal: new AbortController().signal },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorMessage).toMatch(/expected \(path: string\)/);
  });
});

describe('broker: fetch', () => {
  it('denies when net cap is none', async () => {
    const res = await handleBrokerRequest(
      req('fetch', ['https://example.com']),
      { caps: { net: { mode: 'none' } }, cwd: '/work', signal: new AbortController().signal },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errorMessage).toMatch(/outside the tool's declared net capability/);
    }
  });

  it('denies when host not in allowlist', async () => {
    const res = await handleBrokerRequest(
      req('fetch', ['https://evil.com/x']),
      {
        caps: { net: { mode: 'allowlist', hosts: ['api.example.com'] } },
        cwd: '/work',
        signal: new AbortController().signal,
      },
    );
    expect(res.ok).toBe(false);
  });

  it('denies malformed URL args', async () => {
    const res = await handleBrokerRequest(
      req('fetch', [42]),
      { caps: { net: { mode: 'any' } }, cwd: '/work', signal: new AbortController().signal },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorMessage).toMatch(/expected \(url: string\)/);
  });
});

describe('broker: dispatch', () => {
  it('rejects unknown ops', async () => {
    const res = await handleBrokerRequest(
      // Bad op smuggled past the type system to verify the runtime guard.
      { type: 'broker-request', id: 1, op: 'bogus' as never, args: [] },
      { caps: {}, cwd: '/work', signal: new AbortController().signal },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorMessage).toMatch(/unknown op/);
  });
});
