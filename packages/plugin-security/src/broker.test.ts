import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
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

  // u105-3 regression: brokerExec must cap buffered output, not OOM the host.
  it('rejects when subprocess output exceeds the byte cap', async () => {
    // `yes` floods stdout forever; the broker should kill it once the cap is
    // crossed rather than buffering gigabytes.
    const res = await handleBrokerRequest(
      req('exec', ['/usr/bin/yes', ['MOXXY_FLOOD']]),
      { caps: { subprocess: true }, cwd: '/tmp', signal: new AbortController().signal },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorMessage).toMatch(/exceeded the .* limit/);
  }, 20000);

  // u105-3 control: a normal, small output is NOT truncated/rejected.
  it('returns normal-sized output unchanged', async () => {
    const res = await handleBrokerRequest(
      req('exec', ['/bin/echo', ['small-output']]),
      { caps: { subprocess: true }, cwd: '/tmp', signal: new AbortController().signal },
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      const v = res.value as { stdout: string };
      expect(v.stdout).toContain('small-output');
    }
  });

  // u105-9 regression: aborting must settle the broker request PROMPTLY even
  // for a child that traps SIGTERM — the old code only killed and then waited
  // for 'close', which a trapped child never emits, wedging the request forever.
  it('rejects promptly on abort even when the child ignores SIGTERM', async () => {
    const ac = new AbortController();
    // `trap '' TERM` makes the child ignore SIGTERM; a naive kill+wait-for-close
    // would hang on the `sleep 30`.
    const promise = handleBrokerRequest(
      req('exec', ['/bin/sh', ['-c', "trap '' TERM; sleep 30"]]),
      { caps: { subprocess: true }, cwd: '/tmp', signal: ac.signal },
    );
    // Give the shell a moment to install the trap, then abort.
    await new Promise((r) => setTimeout(r, 200));
    const started = Date.now();
    ac.abort();
    const res = await promise;
    const elapsed = Date.now() - started;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorMessage).toMatch(/aborted/);
    // Settled well before the SIGKILL grace + the child's own 30s sleep — the
    // promise resolved off the abort, not off a (never-arriving) clean close.
    expect(elapsed).toBeLessThan(1500);
  }, 10000);
});

// ---------- u105-1: redirect SSRF ----------

describe('broker: fetch redirect re-validation (u105-1)', () => {
  let server: http.Server;
  let allowedPort = 0;
  let host = '';

  beforeAll(async () => {
    server = http.createServer((reqMsg, res) => {
      const url = reqMsg.url ?? '/';
      if (url.startsWith('/redirect-internal')) {
        // 302 to a forbidden internal target (cloud-metadata style host).
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
        res.end();
        return;
      }
      if (url.startsWith('/redirect-same')) {
        // 302 to another path on the SAME (allowlisted) host — must be allowed.
        res.writeHead(302, { location: '/landing' });
        res.end();
        return;
      }
      if (url.startsWith('/landing')) {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('landed-ok');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('hello');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    allowedPort = (server.address() as AddressInfo).port;
    host = `127.0.0.1`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('refuses a redirect to a host outside the allowlist', async () => {
    const res = await handleBrokerRequest(
      req('fetch', [`http://${host}:${allowedPort}/redirect-internal`]),
      {
        // Only the local test host is allowlisted; 169.254.169.254 is NOT.
        caps: { net: { mode: 'allowlist', hosts: [host] } },
        cwd: '/work',
        signal: new AbortController().signal,
      },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errorMessage).toMatch(/redirect target .* is outside the tool's declared net capability/);
    }
  });

  it('follows a same-host redirect to an allowlisted target', async () => {
    const res = await handleBrokerRequest(
      req('fetch', [`http://${host}:${allowedPort}/redirect-same`]),
      {
        caps: { net: { mode: 'allowlist', hosts: [host] } },
        cwd: '/work',
        signal: new AbortController().signal,
      },
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      const v = res.value as { status: number; body: string };
      expect(v.status).toBe(200);
      expect(v.body).toBe('landed-ok');
    }
  });

  // u105-3 fetch-side control: a normal small body comes back intact.
  it('returns a normal-sized body intact', async () => {
    const res = await handleBrokerRequest(
      req('fetch', [`http://${host}:${allowedPort}/`]),
      {
        caps: { net: { mode: 'allowlist', hosts: [host] } },
        cwd: '/work',
        signal: new AbortController().signal,
      },
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      const v = res.value as { body: string };
      expect(v.body).toBe('hello');
    }
  });
});

// ---------- u105-3: oversized fetch body ----------

describe('broker: fetch body cap (u105-3)', () => {
  let server: http.Server;
  let port = 0;

  beforeAll(async () => {
    server = http.createServer((_reqMsg, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      // Stream well past the 8MB cap (16MB) so the broker must abort mid-read.
      const chunk = Buffer.alloc(1024 * 1024, 0x61); // 1MB of 'a'
      let sent = 0;
      const pump = (): void => {
        while (sent < 16) {
          sent++;
          if (!res.write(chunk)) {
            res.once('drain', pump);
            return;
          }
        }
        res.end();
      };
      pump();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rejects a response body that exceeds the cap', async () => {
    const res = await handleBrokerRequest(
      req('fetch', [`http://127.0.0.1:${port}/big`]),
      {
        caps: { net: { mode: 'allowlist', hosts: ['127.0.0.1'] } },
        cwd: '/work',
        signal: new AbortController().signal,
      },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorMessage).toMatch(/exceeded the .*-byte limit/);
  }, 20000);
});

// ---------- u105-4: symlink / realpath scope re-check ----------

describe('broker: fs symlink escape (u105-4)', () => {
  let scope = '';
  let outside = '';

  beforeAll(async () => {
    scope = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-scope-'));
    outside = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-outside-'));
    await fs.writeFile(path.join(outside, 'secret.txt'), 'TOP-SECRET');
    await fs.writeFile(path.join(scope, 'real.txt'), 'in-scope-data');
    // A symlink that lexically lives inside scope but points OUTSIDE it.
    await fs.symlink(path.join(outside, 'secret.txt'), path.join(scope, 'escape-link'));
  });

  afterAll(async () => {
    await fs.rm(scope, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  it('blocks reading a symlink that escapes the declared scope', async () => {
    const res = await handleBrokerRequest(
      req('fs.readFile', [path.join(scope, 'escape-link')]),
      {
        caps: { fs: { read: [`${scope}/**`] } },
        cwd: scope,
        signal: new AbortController().signal,
      },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errorMessage).toMatch(/resolves \(via symlink\) to/);
    }
  });

  it('still reads a legitimate in-scope file (no false positive)', async () => {
    const res = await handleBrokerRequest(
      req('fs.readFile', [path.join(scope, 'real.txt')]),
      {
        caps: { fs: { read: [`${scope}/**`] } },
        cwd: scope,
        signal: new AbortController().signal,
      },
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toBe('in-scope-data');
  });

  it('allows a symlink that resolves to a target still inside scope', async () => {
    // link -> real.txt, both inside scope: must remain readable.
    const linkInside = path.join(scope, 'inside-link');
    await fs.symlink(path.join(scope, 'real.txt'), linkInside);
    const res = await handleBrokerRequest(
      req('fs.readFile', [linkInside]),
      {
        caps: { fs: { read: [`${scope}/**`] } },
        cwd: scope,
        signal: new AbortController().signal,
      },
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toBe('in-scope-data');
  });
});
