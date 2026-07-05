import { describe, expect, it } from 'vitest';
import { HostClient, type ChildHandle, type ForkLike } from './host-client.js';
import type { HostReply, HostRequest } from './host-protocol.js';

/** A controllable fake sidecar: records sent requests + kill, and lets the test
 *  drive `message`/`exit`/`error` back to the client. */
class FakeChild implements ChildHandle {
  readonly sent: HostRequest[] = [];
  killed = false;
  private readonly listeners: Record<string, Array<(...a: unknown[]) => void>> = {
    message: [],
    exit: [],
    error: [],
  };

  send(message: unknown): boolean {
    this.sent.push(message as HostRequest);
    return true;
  }
  on(event: string, listener: (...args: unknown[]) => void): this {
    this.listeners[event]!.push(listener);
    return this;
  }
  kill(): boolean {
    this.killed = true;
    return true;
  }

  private emit(event: string, ...args: unknown[]): void {
    for (const cb of [...this.listeners[event]!]) cb(...args);
  }
  /** Reply to the last request the client sent. */
  replyOk(samples: number[], sampleRate = 22050): void {
    this.replyOkTo(this.sent.at(-1)!.id, samples, sampleRate);
  }
  /** Reply to a specific request id (drives out-of-order correlation tests). */
  replyOkTo(id: number, samples: number[], sampleRate = 22050): void {
    this.emit('message', { id, ok: true, samples: new Float32Array(samples), sampleRate } satisfies HostReply);
  }
  replyErr(kind: 'init' | 'runtime', message: string): void {
    const id = this.sent.at(-1)!.id;
    this.emit('message', { id, ok: false, error: { kind, message } } satisfies HostReply);
  }
  crash(code = 1): void {
    this.emit('exit', code, null);
  }
  errorOut(message: string): void {
    this.emit('error', new Error(message));
  }
}

/** A fork factory handing out a fixed list of children, tracking call count. */
function forkFactory(children: FakeChild[]): { fork: ForkLike; calls: () => number } {
  let n = 0;
  const fork: ForkLike = () => {
    const child = children[n];
    n += 1;
    if (!child) throw new Error(`unexpected fork #${n}`);
    return child;
  };
  return { fork, calls: () => n };
}

const REQ = {
  voiceKey: '/m/model.onnx',
  model: '/m/model.onnx',
  tokens: '/m/tokens.txt',
  dataDir: '/m/espeak-ng-data',
  numThreads: 2,
  provider: 'cpu',
  text: 'hello',
  sid: 0,
  speed: 1,
};

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('HostClient', () => {
  it('does not fork until the first synthesize (lazy spawn)', async () => {
    const child = new FakeChild();
    const { fork, calls } = forkFactory([child]);
    const host = new HostClient({ hostPath: '/x/sidecar.js', env: {}, forkImpl: fork });
    expect(calls()).toBe(0);
    const p = host.synthesize(REQ);
    await tick();
    expect(calls()).toBe(1);
    child.replyOk([0.5, -0.5], 16000);
    await expect(p).resolves.toEqual({ samples: new Float32Array([0.5, -0.5]), sampleRate: 16000 });
    host.shutdown();
  });

  it('correlates replies by id and reuses one child across calls', async () => {
    const child = new FakeChild();
    const { fork, calls } = forkFactory([child]);
    const host = new HostClient({ hostPath: '/x/sidecar.js', env: {}, forkImpl: fork });

    const p1 = host.synthesize({ ...REQ, text: 'one' });
    await tick();
    const p2 = host.synthesize({ ...REQ, text: 'two' });
    await tick();
    // Two distinct ids were sent to the same child.
    expect(child.sent.map((m) => m.id)).toEqual([1, 2]);
    expect(calls()).toBe(1);
    // Reply out of order — id correlation must still settle each promise.
    child.replyOkTo(2, [2]);
    child.replyOkTo(1, [1]);
    await expect(p1).resolves.toMatchObject({ samples: new Float32Array([1]) });
    await expect(p2).resolves.toMatchObject({ samples: new Float32Array([2]) });
    host.shutdown();
  });

  it('rejects a synthesis error reply', async () => {
    const child = new FakeChild();
    const { fork } = forkFactory([child]);
    const host = new HostClient({ hostPath: '/x/sidecar.js', env: {}, forkImpl: fork });
    const p = host.synthesize(REQ);
    await tick();
    child.replyErr('runtime', 'boom');
    await expect(p).rejects.toThrow(/runtime error: boom/);
    host.shutdown();
  });

  it('restarts the sidecar once on a crash and completes on the fresh child', async () => {
    const first = new FakeChild();
    const second = new FakeChild();
    const { fork, calls } = forkFactory([first, second]);
    const host = new HostClient({ hostPath: '/x/sidecar.js', env: {}, forkImpl: fork });

    const p = host.synthesize(REQ);
    await tick();
    expect(calls()).toBe(1);
    first.crash(139); // dies with the request in flight
    await tick();
    // A fresh child was spawned for the retry.
    expect(calls()).toBe(2);
    second.replyOk([0.25], 8000);
    await expect(p).resolves.toEqual({ samples: new Float32Array([0.25]), sampleRate: 8000 });
    host.shutdown();
  });

  it('gives up after a second consecutive crash', async () => {
    const first = new FakeChild();
    const second = new FakeChild();
    const { fork } = forkFactory([first, second]);
    const host = new HostClient({ hostPath: '/x/sidecar.js', env: {}, forkImpl: fork });
    const p = host.synthesize(REQ);
    await tick();
    first.crash();
    await tick();
    second.crash();
    await expect(p).rejects.toThrow(/sidecar exited/);
    host.shutdown();
  });

  it('treats a spawn error as a crash', async () => {
    const child = new FakeChild();
    const second = new FakeChild();
    const { fork } = forkFactory([child, second]);
    const host = new HostClient({ hostPath: '/x/sidecar.js', env: {}, forkImpl: fork });
    const p = host.synthesize(REQ);
    await tick();
    child.errorOut('ENOENT node');
    await tick();
    second.replyOk([1]);
    await expect(p).resolves.toMatchObject({ samples: new Float32Array([1]) });
    host.shutdown();
  });

  it('times out a hung synthesis and kills the child', async () => {
    const child = new FakeChild();
    const { fork } = forkFactory([child]);
    const host = new HostClient({
      hostPath: '/x/sidecar.js',
      env: {},
      forkImpl: fork,
      requestTimeoutMs: 10,
    });
    const p = host.synthesize(REQ);
    await expect(p).rejects.toThrow(/timed out/);
    expect(child.killed).toBe(true);
    host.shutdown();
  });

  it('shutdown kills the child and rejects in-flight requests', async () => {
    const child = new FakeChild();
    const { fork } = forkFactory([child]);
    const host = new HostClient({ hostPath: '/x/sidecar.js', env: {}, forkImpl: fork });
    const p = host.synthesize(REQ);
    await tick();
    host.shutdown();
    expect(child.killed).toBe(true);
    await expect(p).rejects.toThrow(/shut down/);
    // Further calls fail fast.
    await expect(host.synthesize(REQ)).rejects.toThrow(/shut down/);
  });
});
