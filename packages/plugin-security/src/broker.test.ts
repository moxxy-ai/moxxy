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

describe('broker: fs.writeFile', () => {
  it('writes when path is in scope', async () => {
    const tmp = path.join(os.tmpdir(), `moxxy-broker-write-${Date.now()}.txt`);
    try {
      const res = await handleBrokerRequest(
        req('fs.writeFile', [tmp, 'broker wrote this']),
        {
          caps: { fs: { write: [`${os.tmpdir()}/**`] } },
          cwd: '/work',
          signal: new AbortController().signal,
        },
      );
      expect(res.ok).toBe(true);
      expect(await fs.readFile(tmp, 'utf8')).toBe('broker wrote this');
    } finally {
      await fs.unlink(tmp).catch(() => undefined);
    }
  });

  it('denies write when path is out of write-scope', async () => {
    const res = await handleBrokerRequest(
      req('fs.writeFile', ['/etc/should-fail', 'nope']),
      {
        caps: { fs: { read: ['/etc/**'], write: ['$cwd/**'] } },
        cwd: '/work',
        signal: new AbortController().signal,
      },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorMessage).toMatch(/fs\.write capability/);
  });

  it('does NOT grant write from a read cap', async () => {
    const res = await handleBrokerRequest(
      req('fs.writeFile', [`${os.tmpdir()}/x.txt`, 'data']),
      {
        caps: { fs: { read: [`${os.tmpdir()}/**`] } },
        cwd: '/work',
        signal: new AbortController().signal,
      },
    );
    expect(res.ok).toBe(false);
  });
});

describe('broker: fs.readdir', () => {
  it('lists when path is in scope', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-readdir-'));
    try {
      await fs.writeFile(path.join(tmp, 'a.txt'), 'a');
      const res = await handleBrokerRequest(
        req('fs.readdir', [tmp]),
        {
          caps: { fs: { read: [`${os.tmpdir()}/**`] } },
          cwd: '/work',
          signal: new AbortController().signal,
        },
      );
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value).toContain('a.txt');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('denies readdir out of scope', async () => {
    const res = await handleBrokerRequest(
      req('fs.readdir', ['/etc']),
      { caps: { fs: { read: ['$cwd/**'] } }, cwd: '/work', signal: new AbortController().signal },
    );
    expect(res.ok).toBe(false);
  });
});

describe('broker: fs.stat', () => {
  it('stats when path is in scope', async () => {
    const tmp = path.join(os.tmpdir(), `moxxy-stat-${Date.now()}.txt`);
    await fs.writeFile(tmp, 'xyz');
    try {
      const res = await handleBrokerRequest(
        req('fs.stat', [tmp]),
        {
          caps: { fs: { read: [`${os.tmpdir()}/**`] } },
          cwd: '/work',
          signal: new AbortController().signal,
        },
      );
      expect(res.ok).toBe(true);
      if (res.ok) {
        const v = res.value as { isFile: boolean; size: number };
        expect(v.isFile).toBe(true);
        expect(v.size).toBe(3);
      }
    } finally {
      await fs.unlink(tmp);
    }
  });
});

describe('broker: exec', () => {
  it('denies when caps.subprocess is not declared', async () => {
    const res = await handleBrokerRequest(
      req('exec', ['/bin/echo', ['hi']]),
      { caps: {}, cwd: '/tmp', signal: new AbortController().signal },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorMessage).toMatch(/subprocess: true/);
  });

  it('runs when subprocess is allowed', async () => {
    const res = await handleBrokerRequest(
      req('exec', ['/bin/echo', ['hello-broker']]),
      { caps: { subprocess: true }, cwd: '/tmp', signal: new AbortController().signal },
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      const v = res.value as { stdout: string; exitCode: number | null };
      expect(v.stdout).toContain('hello-broker');
      expect(v.exitCode).toBe(0);
    }
  });

  it('honors a commands allowlist (allow)', async () => {
    const res = await handleBrokerRequest(
      req('exec', ['/bin/echo', ['ok']]),
      {
        caps: {
          subprocess: true,
          ...({ commands: ['echo'] } as Record<string, unknown>),
        },
        cwd: '/tmp',
        signal: new AbortController().signal,
      },
    );
    expect(res.ok).toBe(true);
  });

  it('honors a commands allowlist (deny)', async () => {
    const res = await handleBrokerRequest(
      req('exec', ['/bin/cat', ['/etc/hosts']]),
      {
        caps: {
          subprocess: true,
          ...({ commands: ['echo'] } as Record<string, unknown>),
        },
        cwd: '/tmp',
        signal: new AbortController().signal,
      },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorMessage).toMatch(/commands allowlist/);
  });
});
