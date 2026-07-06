import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertDefined } from '@moxxy/sdk';
import type { RpcStream } from './jsonrpc.js';
import {
  SignalSidecar,
  findSignalCliOnPath,
  listSignalAccounts,
  signalCliAttachmentsDir,
  signalCliDataDir,
  startLinkProcess,
  type SpawnedProcess,
} from './sidecar.js';

class FakeChild extends EventEmitter {
  pid = 4242;
  kills: string[] = [];
  stderr = new EventEmitter();
  stdout = new EventEmitter();
  /** Which signal (if any) makes this child actually exit. */
  exitOn: Set<string>;
  constructor(exitOn: string[] = ['SIGTERM', 'SIGKILL']) {
    super();
    this.exitOn = new Set(exitOn);
  }
  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.kills.push(signal);
    if (this.exitOn.has(signal)) {
      // Exit asynchronously, like a real process.
      setImmediate(() => this.emit('exit', null));
    }
    return true;
  }
}

class HealthyStream extends EventEmitter implements RpcStream {
  written: string[] = [];
  write(data: string): boolean {
    this.written.push(data);
    // Auto-answer any request (the health check's `version`).
    const req = JSON.parse(data) as { id: string; method: string };
    setImmediate(() => {
      this.emit('data', `{"jsonrpc":"2.0","id":"${req.id}","result":{"version":"0.13.18"}}\n`);
    });
    return true;
  }
  end(): void {}
  destroy(): void {}
}

describe('SignalSidecar lifecycle', () => {
  it('spawns the daemon with account + unix socket args and health-checks it', async () => {
    const child = new FakeChild();
    let spawned: { command: string; args: ReadonlyArray<string> } | null = null;
    const sidecar = new SignalSidecar({
      account: '+15551234567',
      binary: '/opt/bin/signal-cli',
      spawnFn: (command, args) => {
        spawned = { command, args };
        return child as unknown as SpawnedProcess;
      },
      connectFn: async () => new HealthyStream(),
    });
    const rpc = await sidecar.start();
    expect(spawned).not.toBeNull();
    const capturedSpawn = spawned;
    assertDefined(capturedSpawn, 'spawnFn was invoked during start()');
    expect(capturedSpawn.command).toBe('/opt/bin/signal-cli');
    expect(capturedSpawn.args).toEqual([
      '-a',
      '+15551234567',
      'daemon',
      '--socket',
      sidecar.socketPath,
      '--receive-mode',
      'on-start',
    ]);
    expect(rpc).toBeTruthy();
    await sidecar.stop();
    expect(child.kills).toEqual(['SIGTERM']);
  });

  it('retries the socket until the daemon is up', async () => {
    const child = new FakeChild();
    let attempts = 0;
    const sidecar = new SignalSidecar({
      account: '+1',
      spawnFn: () => child as unknown as SpawnedProcess,
      connectFn: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('ECONNREFUSED');
        return new HealthyStream();
      },
      bootTimeoutMs: 5_000,
    });
    await sidecar.start();
    expect(attempts).toBe(3);
    await sidecar.stop();
  });

  it('rejects with the stderr tail when the daemon exits during boot', async () => {
    const child = new FakeChild();
    const sidecar = new SignalSidecar({
      account: '+1',
      spawnFn: () => {
        setImmediate(() => {
          child.stderr.emit('data', Buffer.from('User +1 is not registered.\n'));
          child.emit('exit', 1);
        });
        return child as unknown as SpawnedProcess;
      },
      connectFn: async () => {
        throw new Error('ECONNREFUSED');
      },
      bootTimeoutMs: 5_000,
    });
    await expect(sidecar.start()).rejects.toThrow(/not registered/);
  });

  it('rejects when the socket never opens within the boot timeout', async () => {
    const child = new FakeChild();
    const sidecar = new SignalSidecar({
      account: '+1',
      spawnFn: () => child as unknown as SpawnedProcess,
      connectFn: async () => {
        throw new Error('ECONNREFUSED');
      },
      bootTimeoutMs: 600,
      killGraceMs: 50,
    });
    await expect(sidecar.start()).rejects.toThrow(/did not open its socket within 600ms/);
    // The child was reaped, not orphaned.
    expect(child.kills).toContain('SIGTERM');
  });

  it('escalates SIGTERM → SIGKILL when the daemon ignores the grace window', async () => {
    const child = new FakeChild(['SIGKILL']); // ignores SIGTERM
    const sidecar = new SignalSidecar({
      account: '+1',
      spawnFn: () => child as unknown as SpawnedProcess,
      connectFn: async () => new HealthyStream(),
      killGraceMs: 60,
    });
    await sidecar.start();
    await sidecar.stop();
    expect(child.kills).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('notifies onExit when the daemon dies unexpectedly', async () => {
    const child = new FakeChild();
    const sidecar = new SignalSidecar({
      account: '+1',
      spawnFn: () => child as unknown as SpawnedProcess,
      connectFn: async () => new HealthyStream(),
    });
    await sidecar.start();
    const codes: Array<number | null> = [];
    sidecar.onExit((code) => codes.push(code));
    child.emit('exit', 137);
    expect(codes).toEqual([137]);
    await sidecar.stop();
  });
});

describe('startLinkProcess', () => {
  it('resolves the sgnl:// URI from stdout and the account on success', async () => {
    const child = new FakeChild();
    const link = startLinkProcess({
      deviceName: 'moxxy',
      spawnFn: (command, args) => {
        expect(command).toBe('signal-cli');
        expect(args).toEqual(['link', '-n', 'moxxy']);
        return child as unknown as SpawnedProcess;
      },
    });
    child.stdout.emit('data', Buffer.from('sgnl://linkdevice?uuid=abc&pub_key=def\n'));
    await expect(link.uri).resolves.toBe('sgnl://linkdevice?uuid=abc&pub_key=def');
    child.stdout.emit('data', Buffer.from('Associated with: +15551234567 (device id: 2)\n'));
    child.emit('exit', 0);
    await expect(link.completed).resolves.toEqual({ account: '+15551234567' });
  });

  it('understands the legacy tsdevice:/ URI form', async () => {
    const child = new FakeChild();
    const link = startLinkProcess({
      deviceName: 'moxxy',
      spawnFn: () => child as unknown as SpawnedProcess,
    });
    child.stdout.emit('data', Buffer.from('tsdevice:/?uuid=abc&pub_key=def\n'));
    await expect(link.uri).resolves.toBe('tsdevice:/?uuid=abc&pub_key=def');
    link.cancel();
    expect(child.kills).toEqual(['SIGTERM']);
    child.emit('exit', 1);
    await expect(link.completed).rejects.toThrow(/exited with code 1/);
  });

  it('rejects both promises when linking fails before a URI appears', async () => {
    const child = new FakeChild();
    const link = startLinkProcess({
      deviceName: 'moxxy',
      spawnFn: () => child as unknown as SpawnedProcess,
    });
    child.emit('exit', 2);
    await expect(link.uri).rejects.toThrow(/code 2/);
    await expect(link.completed).rejects.toThrow(/code 2/);
  });
});

describe('listSignalAccounts', () => {
  it('parses --output=json account listings', async () => {
    const child = new FakeChild();
    const p = listSignalAccounts({
      spawnFn: (command, args) => {
        expect(args).toEqual(['--output=json', 'listAccounts']);
        void command;
        setImmediate(() => {
          child.stdout.emit('data', Buffer.from('[{"number":"+15551234567"},{"number":"+491771234567"}]\n'));
          child.emit('exit', 0);
        });
        return child as unknown as SpawnedProcess;
      },
    });
    await expect(p).resolves.toEqual(['+15551234567', '+491771234567']);
  });

  it('falls back to scraping numbers from plain-text output', async () => {
    const child = new FakeChild();
    const p = listSignalAccounts({
      spawnFn: () => {
        setImmediate(() => {
          child.stdout.emit('data', Buffer.from('Number: +15551234567\n'));
          child.emit('exit', 0);
        });
        return child as unknown as SpawnedProcess;
      },
    });
    await expect(p).resolves.toEqual(['+15551234567']);
  });
});

describe('findSignalCliOnPath', () => {
  it('returns null (never throws) when the binary is absent', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mox-sig-path-'));
    try {
      expect(findSignalCliOnPath({ PATH: tmp })).toBeNull();
      expect(findSignalCliOnPath({ PATH: undefined as unknown as string })).toBeNull();
      expect(findSignalCliOnPath({})).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('finds an executable signal-cli on PATH', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mox-sig-path-'));
    try {
      const bin = path.join(tmp, 'signal-cli');
      fs.writeFileSync(bin, '#!/bin/sh\n', { mode: 0o755 });
      expect(findSignalCliOnPath({ PATH: `/nonexistent${path.delimiter}${tmp}` })).toBe(bin);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('signal-cli data dirs', () => {
  it('honors XDG_DATA_HOME', () => {
    expect(signalCliDataDir({ XDG_DATA_HOME: '/x/data' })).toBe(path.join('/x/data', 'signal-cli'));
    expect(signalCliAttachmentsDir({ XDG_DATA_HOME: '/x/data' })).toBe(
      path.join('/x/data', 'signal-cli', 'attachments'),
    );
  });

  it('defaults under the home dir', () => {
    expect(signalCliDataDir({})).toBe(path.join(os.homedir(), '.local', 'share', 'signal-cli'));
  });
});
