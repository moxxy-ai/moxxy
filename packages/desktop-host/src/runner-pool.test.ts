import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { homedir } from 'node:os';
import path from 'node:path';
import { socketFor, UNBOUND_ID } from './runner-pool';

const orig = { ...process.env };
beforeEach(() => {
  process.env = { ...orig };
  delete process.env.MOXXY_RUNNER_SOCKET;
});
afterEach(() => {
  process.env = orig;
});

describe('socketFor — platform-correct runner address', () => {
  it('uses a Windows NAMED PIPE for the unbound runner (not a .sock path)', () => {
    // A raw `C:\…\serve.sock` can't be bound on Windows → `moxxy serve` exits.
    expect(socketFor(UNBOUND_ID, 'win32')).toBe('\\\\.\\pipe\\moxxy-serve');
  });

  it('uses a distinct named pipe per workspace on Windows', () => {
    expect(socketFor('ws-1', 'win32')).toBe('\\\\.\\pipe\\moxxy-serve-ws-1');
  });

  it('sanitizes unsafe characters out of the Windows pipe name', () => {
    // Path separators / colons in a workspace id can't appear in a pipe name.
    expect(socketFor('a/b\\c:d', 'win32')).toBe('\\\\.\\pipe\\moxxy-serve-a_b_c_d');
  });

  it('honors MOXXY_RUNNER_SOCKET override for the unbound runner on Windows', () => {
    process.env.MOXXY_RUNNER_SOCKET = '\\\\.\\pipe\\custom';
    expect(socketFor(UNBOUND_ID, 'win32')).toBe('\\\\.\\pipe\\custom');
  });

  it('keeps the ~/.moxxy/*.sock filesystem layout on POSIX', () => {
    expect(socketFor(UNBOUND_ID, 'linux')).toBe(path.join(homedir(), '.moxxy', 'serve.sock'));
    expect(socketFor('ws-1', 'darwin')).toBe(
      path.join(homedir(), '.moxxy', 'desktop', 'sockets', 'serve-ws-1.sock'),
    );
  });

  it('accepts a real UUID workspace id on POSIX', () => {
    const id = '6b1f3c2a-0e4d-4a7b-9c1e-2f3a4b5c6d7e';
    expect(socketFor(id, 'linux')).toBe(
      path.join(homedir(), '.moxxy', 'desktop', 'sockets', `serve-${id}.sock`),
    );
  });

  it('refuses a path-traversal / separator id on POSIX (no escaping the sockets dir)', () => {
    // The renderer is untrusted; a `/`, `\\`, or `..` in a bound id would write
    // a socket outside ~/.moxxy/desktop/sockets — reject it before the fs.
    expect(() => socketFor('../../etc/evil', 'linux')).toThrow(/unsafe workspace id/i);
    expect(() => socketFor('a/b', 'darwin')).toThrow(/unsafe workspace id/i);
    expect(() => socketFor('..', 'linux')).toThrow(/unsafe workspace id/i);
    expect(() => socketFor('with space', 'linux')).toThrow(/unsafe workspace id/i);
  });
});
