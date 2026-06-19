import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { asSessionId, asToolCallId, asTurnId, isToolDisplayResult } from '@moxxy/sdk';
import type { ToolContext, ToolDisplayResult } from '@moxxy/sdk';
import { readTool } from './read.js';
import { writeTool } from './write.js';
import { editTool } from './edit.js';
import { bashTool } from './bash.js';
import { grepTool } from './grep.js';
import { globTool } from './glob.js';
import { sleepTool, resolveSleepMs, MAX_SLEEP_MS } from './sleep.js';
import { resolvePath, resolveWithinCwd, resolveSafe } from './util.js';

let tmp: string;

const baseCtx = (): ToolContext => ({
  sessionId: asSessionId('s'),
  turnId: asTurnId('t'),
  callId: asToolCallId('c'),
  cwd: tmp,
  signal: new AbortController().signal,
  log: { length: 0, at: () => undefined, slice: () => [], ofType: () => [], byTurn: () => [], toJSON: () => [] },
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
});

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-tools-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('readTool', () => {
  it('reads file with line numbers', async () => {
    await fs.writeFile(path.join(tmp, 'a.txt'), 'one\ntwo\nthree');
    const out = (await readTool.handler({ file_path: 'a.txt' }, baseCtx())) as string;
    expect(out).toContain('1\tone');
    expect(out).toContain('3\tthree');
  });

  it('respects offset/limit', async () => {
    await fs.writeFile(path.join(tmp, 'a.txt'), 'a\nb\nc\nd');
    const out = (await readTool.handler({ file_path: 'a.txt', offset: 1, limit: 2 }, baseCtx())) as string;
    expect(out).toContain('2\tb');
    expect(out).toContain('3\tc');
    expect(out).not.toContain('1\ta');
    expect(out).not.toContain('4\td');
  });

  it('refuses to slurp a file beyond the size cap (does not OOM the heap)', async () => {
    // >10MB file — the working-set cap must reject it before reading into heap.
    await fs.writeFile(path.join(tmp, 'huge.log'), 'x'.repeat(11 * 1024 * 1024));
    await expect(readTool.handler({ file_path: 'huge.log' }, baseCtx())).rejects.toThrow(
      /file too large/i,
    );
  });
});

describe('writeTool', () => {
  it('writes and creates parent dirs', async () => {
    await writeTool.handler({ file_path: 'nested/dir/file.txt', content: 'hello' }, baseCtx());
    const text = await fs.readFile(path.join(tmp, 'nested/dir/file.txt'), 'utf8');
    expect(text).toBe('hello');
  });
});

describe('editTool', () => {
  it('replaces a unique occurrence and returns a file-diff display', async () => {
    await fs.writeFile(path.join(tmp, 'a.txt'), 'foo bar baz');
    const result = await editTool.handler(
      { file_path: 'a.txt', old_string: 'bar', new_string: 'qux', replace_all: false },
      baseCtx(),
    );
    expect(await fs.readFile(path.join(tmp, 'a.txt'), 'utf8')).toBe('foo qux baz');
    expect(isToolDisplayResult(result)).toBe(true);
    const r = result as ToolDisplayResult;
    expect(r.display.kind).toBe('file-diff');
    expect(r.forModel).toContain('a.txt');
  });

  it('errors when old_string is not unique without replace_all', async () => {
    await fs.writeFile(path.join(tmp, 'a.txt'), 'foo foo');
    await expect(
      editTool.handler({ file_path: 'a.txt', old_string: 'foo', new_string: 'bar', replace_all: false }, baseCtx()),
    ).rejects.toThrow(/not unique/);
  });

  it('replace_all replaces every occurrence', async () => {
    await fs.writeFile(path.join(tmp, 'a.txt'), 'foo foo foo');
    await editTool.handler(
      { file_path: 'a.txt', old_string: 'foo', new_string: 'X', replace_all: true },
      baseCtx(),
    );
    expect(await fs.readFile(path.join(tmp, 'a.txt'), 'utf8')).toBe('X X X');
  });

  it('errors when old_string not present', async () => {
    await fs.writeFile(path.join(tmp, 'a.txt'), 'hello');
    await expect(
      editTool.handler({ file_path: 'a.txt', old_string: 'missing', new_string: 'x', replace_all: false }, baseCtx()),
    ).rejects.toThrow(/not found/);
  });

  it('refuses to edit a file beyond the size cap', async () => {
    await fs.writeFile(path.join(tmp, 'huge.txt'), 'x'.repeat(11 * 1024 * 1024));
    await expect(
      editTool.handler({ file_path: 'huge.txt', old_string: 'x', new_string: 'y', replace_all: false }, baseCtx()),
    ).rejects.toThrow(/file too large/i);
  });
});

describe('bashTool', () => {
  it('runs a command and captures stdout', async () => {
    const out = (await bashTool.handler({ command: 'echo hi', timeoutMs: 5000 }, baseCtx())) as string;
    expect(out).toContain('hi');
    expect(out).toContain('[exit 0]');
  });

  it('captures non-zero exit', async () => {
    const out = (await bashTool.handler({ command: 'exit 3', timeoutMs: 5000 }, baseCtx())) as string;
    expect(out).toContain('[exit 3]');
  });

  it('times out long commands', async () => {
    await expect(
      bashTool.handler({ command: 'sleep 1', timeoutMs: 50 }, baseCtx()),
    ).rejects.toThrow(/timed out/);
  });

  it('respects abort signal', async () => {
    const controller = new AbortController();
    const ctx = { ...baseCtx(), signal: controller.signal };
    const p = bashTool.handler({ command: 'sleep 2', timeoutMs: 5000 }, ctx) as Promise<string>;
    setTimeout(() => controller.abort(), 50);
    const result = await p;
    expect(result).toMatch(/exit/);
  });

  it('rejects immediately when the signal is already aborted (does not spawn)', async () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = { ...baseCtx(), signal: controller.signal };
    await expect(
      bashTool.handler({ command: 'echo should-not-run', timeoutMs: 5000 }, ctx),
    ).rejects.toThrow(/aborted before start/);
  });

  // Spawns a SIGTERM-ignoring grandchild and records its PID, so tests can
  // assert the *whole group* dies (SIGTERM → 2s grace → SIGKILL), not just
  // the direct shell.
  const stubbornChildCommand = (pidFile: string): string =>
    `sh -c 'trap "" TERM; sleep 30' & echo $! > "${pidFile}"; wait`;

  const isAlive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  const waitForChildPid = async (pidFile: string): Promise<number> => {
    for (let i = 0; i < 50; i++) {
      try {
        const text = await fs.readFile(pidFile, 'utf8');
        const pid = Number.parseInt(text.trim(), 10);
        if (Number.isFinite(pid) && pid > 0) return pid;
      } catch {
        // not written yet
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('child pid file never appeared');
  };

  const waitUntilDead = async (pid: number, timeoutMs: number): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!isAlive(pid)) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return !isAlive(pid);
  };

  it('kills the whole process group (incl. SIGTERM-ignoring children) on timeout', async () => {
    const pidFile = path.join(tmp, 'child.pid');
    const p = bashTool.handler({ command: stubbornChildCommand(pidFile), timeoutMs: 300 }, baseCtx());
    const rejection = expect(p).rejects.toThrow(/timed out/);
    const childPid = await waitForChildPid(pidFile);
    await rejection;
    // SIGTERM is ignored by the grandchild; SIGKILL escalation (2s grace)
    // must take the whole group down.
    expect(await waitUntilDead(childPid, 4_000)).toBe(true);
  }, 10_000);

  it('kills the whole process group (incl. SIGTERM-ignoring children) on abort', async () => {
    const pidFile = path.join(tmp, 'child.pid');
    const controller = new AbortController();
    const ctx = { ...baseCtx(), signal: controller.signal };
    const p = bashTool.handler({ command: stubbornChildCommand(pidFile), timeoutMs: 30_000 }, ctx) as Promise<string>;
    const childPid = await waitForChildPid(pidFile);
    controller.abort();
    // The grandchild holds our stdout pipe; without group SIGKILL the tool
    // would hang here forever waiting for 'close'.
    const result = await p;
    expect(result).toMatch(/exit/);
    expect(await waitUntilDead(childPid, 4_000)).toBe(true);
  }, 10_000);

  it('scrubs secret-looking parent env vars before spawning the shell', async () => {
    // A secret the runner holds in process.env must not reach the child shell;
    // a benign var must still pass through (usability preserved).
    process.env.MOX_TEST_SECRET_TOKEN = 'leak-me';
    process.env.MOX_TEST_BENIGN_VAR = 'keep-me';
    try {
      const out = (await bashTool.handler(
        { command: 'printenv MOX_TEST_SECRET_TOKEN || true; printenv MOX_TEST_BENIGN_VAR || true', timeoutMs: 5000 },
        baseCtx(),
      )) as string;
      expect(out).not.toContain('leak-me');
      expect(out).toContain('keep-me');
    } finally {
      delete process.env.MOX_TEST_SECRET_TOKEN;
      delete process.env.MOX_TEST_BENIGN_VAR;
    }
  });

  it('lets the model re-supply a needed var via the env input', async () => {
    process.env.MOX_TEST_API_KEY = 'inherited-secret';
    try {
      const out = (await bashTool.handler(
        { command: 'printenv MOX_TEST_API_KEY || true', timeoutMs: 5000, env: { MOX_TEST_API_KEY: 'explicit' } },
        baseCtx(),
      )) as string;
      // The inherited secret value is scrubbed; the explicit overlay wins.
      expect(out).toContain('explicit');
      expect(out).not.toContain('inherited-secret');
    } finally {
      delete process.env.MOX_TEST_API_KEY;
    }
  });

  it('does not corrupt multibyte UTF-8 output (no U+FFFD at chunk boundaries)', async () => {
    // Emit a run of 4-byte emoji; if the sink decoded per-chunk, a sequence
    // split across two data events would yield replacement chars.
    const out = (await bashTool.handler(
      { command: `node -e "process.stdout.write('🚀'.repeat(20000))"`, timeoutMs: 30_000 },
      baseCtx(),
    )) as string;
    expect(out).not.toContain('�');
    expect(out).toContain('🚀');
  }, 30_000);

  it('bounds output retention during streaming and reports full truncated size', async () => {
    const total = 2_097_152; // 2 MiB of 'x' — far beyond the 200k clamp
    const out = (await bashTool.handler(
      { command: `head -c ${total} /dev/zero | tr '\\0' x`, timeoutMs: 30_000 },
      baseCtx(),
    )) as string;
    const limit = 200_000;
    // Retention is capped during streaming: the result can never balloon.
    expect(out.length).toBeLessThanOrEqual(limit + 64);
    // Marker counts the drained chars too — identical to clamping the full
    // combined string ('[stdout]\n' + body + '\n' + '[exit 0]').
    const fullCombinedLength = '[stdout]\n'.length + total + '\n[exit 0]'.length;
    expect(out.endsWith(`\n... [truncated ${fullCombinedLength - limit} chars]`)).toBe(true);
    expect(out.startsWith('[stdout]\nxxx')).toBe(true);
  }, 30_000);
});

describe('grepTool', () => {
  it('finds lines matching pattern', async () => {
    await fs.writeFile(path.join(tmp, 'a.ts'), 'const foo = 1\nconst bar = 2');
    await fs.writeFile(path.join(tmp, 'b.ts'), 'foo and foo');
    const out = (await grepTool.handler({ pattern: 'foo', glob: '*.ts' }, baseCtx())) as string;
    expect(out).toContain('a.ts:1');
    expect(out).toContain('b.ts:1');
  });

  it('respects case insensitivity', async () => {
    await fs.writeFile(path.join(tmp, 'a.txt'), 'HELLO');
    const out = (await grepTool.handler({ pattern: 'hello', caseInsensitive: true }, baseCtx())) as string;
    expect(out).toContain('a.txt:1');
  });

  it('surfaces an invalid regex as a clean error, not a raw SyntaxError', async () => {
    await expect(grepTool.handler({ pattern: '(' }, baseCtx())).rejects.toThrow(
      /invalid regular expression/i,
    );
  });
});

describe('globTool symlinks', () => {
  it('does not emit a directory symlink as a file match, but still matches a file symlink', async () => {
    await fs.mkdir(path.join(tmp, 'target'));
    await fs.symlink(path.join(tmp, 'target'), path.join(tmp, 'dlink'), 'dir');
    // A dir-symlink is a directory, not a file — globbing its name as a file
    // must not match it (the old code emitted it because `isSymbolicLink`
    // triggered the file branch too).
    const dirOut = (await globTool.handler({ pattern: 'dlink' }, baseCtx())) as string;
    expect(dirOut).not.toContain('dlink');

    // A file-symlink must still match as a file (no regression).
    await fs.writeFile(path.join(tmp, 'real.txt'), 'x');
    await fs.symlink(path.join(tmp, 'real.txt'), path.join(tmp, 'flink.txt'), 'file');
    const fileOut = (await globTool.handler({ pattern: 'flink.txt' }, baseCtx())) as string;
    expect(fileOut).toContain('flink.txt');
  });
});

describe('globTool', () => {
  it('finds files by **/* pattern', async () => {
    await fs.mkdir(path.join(tmp, 'src'), { recursive: true });
    await fs.writeFile(path.join(tmp, 'src/a.ts'), '');
    await fs.writeFile(path.join(tmp, 'src/b.ts'), '');
    await fs.writeFile(path.join(tmp, 'src/c.md'), '');
    const out = (await globTool.handler({ pattern: 'src/**/*.ts' }, baseCtx())) as string;
    expect(out).toContain('src/a.ts');
    expect(out).toContain('src/b.ts');
    expect(out).not.toContain('c.md');
  });

  it('terminates on a symlink cycle', async () => {
    // Create dir/loop -> dir, plus a real file inside dir. Before the fix,
    // walk() recursed forever. The handler must complete and find the file.
    const dir = path.join(tmp, 'dir');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'target.ts'), '');
    try {
      await fs.symlink(dir, path.join(dir, 'loop'));
    } catch {
      // Symlink creation may fail on some filesystems — skip in that case.
      return;
    }
    const out = (await globTool.handler({ pattern: 'dir/**/*.ts' }, baseCtx())) as string;
    expect(out).toContain('target.ts');
  });
});

describe('path resolution helpers', () => {
  it('resolvePath normalizes relative + absolute paths without sandbox', () => {
    expect(resolvePath('/work', 'a/b')).toBe(path.resolve('/work', 'a/b'));
    expect(resolvePath('/work', '/etc/passwd')).toBe(path.normalize('/etc/passwd'));
    // Traversal is allowed — the permission layer is what gates real access.
    expect(resolvePath('/work', '../outside')).toBe(path.resolve('/work', '../outside'));
  });

  it('resolveSafe is a backward-compat alias for resolvePath', () => {
    expect(resolveSafe('/x', 'y')).toBe(resolvePath('/x', 'y'));
  });

  it('resolveWithinCwd allows paths inside cwd', () => {
    const out = resolveWithinCwd('/work', 'a/b');
    expect(out).toBe(path.resolve('/work', 'a/b'));
  });

  it('resolveWithinCwd rejects absolute paths outside cwd', () => {
    expect(() => resolveWithinCwd('/work', '/etc/passwd')).toThrow(/escapes cwd/);
  });

  it('resolveWithinCwd rejects traversal escape', () => {
    expect(() => resolveWithinCwd('/work', '../outside')).toThrow(/escapes cwd/);
  });
});

describe('sleepTool', () => {
  describe('resolveSleepMs', () => {
    it('converts seconds to ms', () => {
      expect(resolveSleepMs({ seconds: 2 })).toBe(2000);
    });
    it('passes ms through', () => {
      expect(resolveSleepMs({ ms: 500 })).toBe(500);
    });
    it('sums seconds and ms', () => {
      expect(resolveSleepMs({ seconds: 1, ms: 500 })).toBe(1500);
    });
    it('clamps to MAX_SLEEP_MS', () => {
      expect(resolveSleepMs({ seconds: 9999 })).toBe(MAX_SLEEP_MS);
    });
  });

  it('resolves after the requested delay', async () => {
    const start = Date.now();
    const out = (await sleepTool.handler({ ms: 20 }, baseCtx())) as string;
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
    expect(out).toBe('slept 20ms');
  });

  it('throws when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = { ...baseCtx(), signal: controller.signal };
    await expect(sleepTool.handler({ ms: 50 }, ctx)).rejects.toThrow(/aborted before start/);
  });

  it('aborts mid-sleep when the signal fires', async () => {
    const controller = new AbortController();
    const ctx = { ...baseCtx(), signal: controller.signal };
    const p = sleepTool.handler({ seconds: 5 }, ctx) as Promise<string>;
    setTimeout(() => controller.abort(), 20);
    await expect(p).rejects.toThrow(/interrupted/);
  });
});
