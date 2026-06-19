import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildBrokerEnv, handleBrokerRequest, type BrokerRequest } from './broker.js';

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

  // LOW (audit): the allowlist matched path.basename(command), so a symlink
  // NAMED after an allowlisted binary (e.g. `<tmp>/echo -> /bin/cat`) passed the
  // basename gate yet executed the OTHER binary. The broker now canonicalizes a
  // path-form command and re-checks the resolved target's basename.
  it('denies a path-form command whose symlink resolves to a non-allowlisted binary', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-cmd-link-'));
    const fake = path.join(dir, 'echo'); // basename 'echo' is allowlisted…
    try {
      // …but it actually points at `cat`, which is NOT allowlisted.
      await fs.symlink('/bin/cat', fake);
      const res = await handleBrokerRequest(
        req('exec', [fake, ['/etc/hosts']]),
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
      if (!res.ok) {
        expect(res.errorMessage).toMatch(/resolves to 'cat'.*outside the tool's declared commands allowlist/);
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  // Control: a path-form command whose symlink resolves to an allowlisted
  // binary is still permitted (no false rejection).
  it('allows a path-form command whose symlink resolves to an allowlisted binary', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-cmd-link-ok-'));
    const link = path.join(dir, 'echo');
    try {
      await fs.symlink('/bin/echo', link);
      const res = await handleBrokerRequest(
        req('exec', [link, ['linked-ok']]),
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
      if (res.ok) {
        const v = res.value as { stdout: string };
        expect(v.stdout).toContain('linked-ok');
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  // MEDIUM (audit): argv must be a string[]; a bare string would be spread
  // into single-char args by spawn. Reject with a clear error.
  it('rejects a non-array argv', async () => {
    const res = await handleBrokerRequest(
      req('exec', ['/bin/echo', 'abc']),
      { caps: { subprocess: true }, cwd: '/tmp', signal: new AbortController().signal },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorMessage).toMatch(/expected \(argv: string\[\]\)/);
  });

  it('rejects an argv with a non-string element', async () => {
    const res = await handleBrokerRequest(
      req('exec', ['/bin/echo', ['ok', 42]]),
      { caps: { subprocess: true }, cwd: '/tmp', signal: new AbortController().signal },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorMessage).toMatch(/expected \(argv: string\[\]\)/);
  });

  it('rejects a non-object opts', async () => {
    const res = await handleBrokerRequest(
      req('exec', ['/bin/echo', ['ok'], 'not-an-object']),
      { caps: { subprocess: true }, cwd: '/tmp', signal: new AbortController().signal },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorMessage).toMatch(/expected \(opts: object\)/);
  });

  // MEDIUM (audit): a caller-supplied cwd outside the declared fs.read scope
  // would let an allowlisted command read data outside its declared scope.
  it('rejects an opts.cwd outside the declared fs.read scope', async () => {
    const res = await handleBrokerRequest(
      req('exec', ['/bin/echo', ['x'], { cwd: '/etc' }]),
      {
        caps: { subprocess: true, fs: { read: ['$cwd/**'] } },
        cwd: '/tmp',
        signal: new AbortController().signal,
      },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorMessage).toMatch(/cwd .* is outside the tool's declared fs\.read/);
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

  // SECURITY: a hostile brokered handler must NOT be able to inject code into an
  // allowlisted child via a per-call LD_PRELOAD/DYLD_* env override — that would
  // turn an allowlisted `echo`/`cat` into arbitrary code execution regardless of
  // the command allowlist. The broker strips loader-injection vars from opts.env.
  it('strips LD_PRELOAD from a per-call opts.env before spawning', async () => {
    const res = await handleBrokerRequest(
      req('exec', ['/bin/sh', ['-c', 'printf "%s" "${LD_PRELOAD:-NONE}"'], {
        env: { LD_PRELOAD: '/tmp/evil.so' },
      }]),
      { caps: { subprocess: true, env: ['PATH'] }, cwd: '/tmp', signal: new AbortController().signal },
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      const v = res.value as { stdout: string };
      // The child saw NO LD_PRELOAD — the injection var never reached it.
      expect(v.stdout).toBe('NONE');
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

// ---------- HIGH (audit): cross-host redirect header stripping ----------

describe('broker: fetch strips credentials across cross-host redirect', () => {
  let hostA: http.Server;
  let hostB: http.Server;
  let portA = 0;
  let portB = 0;
  let bReceivedAuth: string | undefined;
  let bReceivedCookie: string | undefined;

  beforeAll(async () => {
    // Host B records whatever headers it receives.
    hostB = http.createServer((reqMsg, res) => {
      bReceivedAuth = reqMsg.headers['authorization'];
      bReceivedCookie = reqMsg.headers['cookie'];
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('host-b-landing');
    });
    await new Promise<void>((resolve) => hostB.listen(0, '127.0.0.1', resolve));
    portB = (hostB.address() as AddressInfo).port;

    // Host A 302-redirects to host B (a DIFFERENT origin: different port).
    hostA = http.createServer((_reqMsg, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${portB}/landing` });
      res.end();
    });
    await new Promise<void>((resolve) => hostA.listen(0, '127.0.0.1', resolve));
    portA = (hostA.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => hostA.close(() => resolve()));
    await new Promise<void>((resolve) => hostB.close(() => resolve()));
  });

  it('does NOT forward Authorization/Cookie to a different-origin redirect target', async () => {
    bReceivedAuth = undefined;
    bReceivedCookie = undefined;
    const res = await handleBrokerRequest(
      req('fetch', [
        `http://127.0.0.1:${portA}/start`,
        { headers: { authorization: 'Bearer SECRET-A', cookie: 'sid=abc' } },
      ]),
      {
        // Both ports share host 127.0.0.1, so both are allowlisted by host —
        // the origin (port) differs, which is what must trigger the strip.
        caps: { net: { mode: 'allowlist', hosts: ['127.0.0.1'] } },
        cwd: '/work',
        signal: new AbortController().signal,
      },
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      const v = res.value as { body: string };
      expect(v.body).toBe('host-b-landing');
    }
    // The credentials set for origin A must NOT have reached origin B.
    expect(bReceivedAuth).toBeUndefined();
    expect(bReceivedCookie).toBeUndefined();
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

  // MEDIUM (audit): a SINGLE-FILE (wildcard-free) cap whose file is a symlink
  // must not, via the realpath re-check, widen to siblings under the parent.
  // Old code took dirname(literal) as the scope root, so `read:['<scope>/link']`
  // where link -> <scope>/sibling validated against the whole '<scope>' dir.
  it('blocks a single-file cap whose file symlinks to a sibling', async () => {
    await fs.writeFile(path.join(scope, 'sibling-secret.txt'), 'SIBLING-SECRET');
    const link = path.join(scope, 'single-link');
    await fs.symlink(path.join(scope, 'sibling-secret.txt'), link);
    const res = await handleBrokerRequest(
      // Cap declares ONLY this exact path — no wildcard.
      req('fs.readFile', [link]),
      {
        caps: { fs: { read: [link] } },
        cwd: scope,
        signal: new AbortController().signal,
      },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errorMessage).toMatch(/resolves \(via symlink\) to/);
  });

  it('still allows a single-file cap on a real (non-symlink) file', async () => {
    const file = path.join(scope, 'plain.txt');
    await fs.writeFile(file, 'plain-data');
    const res = await handleBrokerRequest(
      req('fs.readFile', [file]),
      {
        caps: { fs: { read: [file] } },
        cwd: scope,
        signal: new AbortController().signal,
      },
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toBe('plain-data');
  });
});

// ---------- SECURITY: buildBrokerEnv loader-injection hardening ----------

describe('buildBrokerEnv', () => {
  it('curates from the allowlist and never leaks an un-allowlisted parent var', () => {
    const KEY = `MOXXY_TEST_SECRET_${Date.now()}`;
    process.env[KEY] = 'leak-me';
    process.env['MOXXY_TEST_ALLOWED'] = 'ok';
    try {
      const env = buildBrokerEnv({ env: ['MOXXY_TEST_ALLOWED'] }, undefined);
      expect(env['MOXXY_TEST_ALLOWED']).toBe('ok');
      expect(env[KEY]).toBeUndefined();
    } finally {
      delete process.env[KEY];
      delete process.env['MOXXY_TEST_ALLOWED'];
    }
  });

  it('lets a per-call optsEnv add/override a benign key', () => {
    const env = buildBrokerEnv({ env: [] }, { CUSTOM_FLAG: 'on' });
    expect(env['CUSTOM_FLAG']).toBe('on');
  });

  it('strips LD_PRELOAD / LD_LIBRARY_PATH / LD_AUDIT from optsEnv (case-insensitive)', () => {
    const env = buildBrokerEnv({ env: [] }, {
      LD_PRELOAD: '/tmp/a.so',
      ld_library_path: '/tmp/lib',
      LD_AUDIT: '/tmp/audit.so',
      KEEP: 'yes',
    });
    expect(env['LD_PRELOAD']).toBeUndefined();
    expect(env['ld_library_path']).toBeUndefined();
    expect(env['LD_AUDIT']).toBeUndefined();
    expect(env['KEEP']).toBe('yes');
  });

  it('strips the whole DYLD_* family from optsEnv', () => {
    const env = buildBrokerEnv({ env: [] }, {
      DYLD_INSERT_LIBRARIES: '/tmp/a.dylib',
      DYLD_LIBRARY_PATH: '/tmp/lib',
      DYLD_FRAMEWORK_PATH: '/tmp/fw',
      Dyld_Print_Libraries: '1',
    });
    expect(Object.keys(env).some((k) => k.toLowerCase().startsWith('dyld_'))).toBe(false);
  });

  it('does not allow optsEnv to re-introduce an injection var even if allowlisted', () => {
    // A handler that names LD_PRELOAD in caps.env can inherit the host's value
    // (an auditable authored choice), but the UNFILTERED per-call override must
    // still be dropped — opts.env can never set a loader-injection var.
    process.env['LD_PRELOAD'] = '/host/value.so';
    try {
      const env = buildBrokerEnv({ env: ['LD_PRELOAD'] }, { LD_PRELOAD: '/attacker.so' });
      // The host's allowlisted value survives; the attacker's override does not.
      expect(env['LD_PRELOAD']).toBe('/host/value.so');
    } finally {
      delete process.env['LD_PRELOAD'];
    }
  });
});
