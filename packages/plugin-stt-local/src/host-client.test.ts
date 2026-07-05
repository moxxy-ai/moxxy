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
  replyOk(text: string, language?: string): void {
    this.replyOkTo(this.sent.at(-1)!.id, text, language);
  }
  /** Reply to a specific request id (drives out-of-order correlation tests). */
  replyOkTo(id: number, text: string, language?: string): void {
    const reply: HostReply =
      language !== undefined ? { id, ok: true, text, language } : { id, ok: true, text };
    this.emit('message', reply);
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
  modelKey: '/m/base-encoder.onnx',
  encoder: '/m/base-encoder.onnx',
  decoder: '/m/base-decoder.onnx',
  tokens: '/m/base-tokens.txt',
  numThreads: 2,
  provider: 'cpu',
  language: '',
  task: 'transcribe',
  samples: new Float32Array([0.1, -0.1]),
  sampleRate: 16_000,
};

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('HostClient', () => {
  it('does not fork until the first transcribe (lazy spawn)', async () => {
    const child = new FakeChild();
    const { fork, calls } = forkFactory([child]);
    const host = new HostClient({ hostPath: '/x/sidecar.js', env: {}, forkImpl: fork });
    expect(calls()).toBe(0);
    const p = host.transcribe(REQ);
    await tick();
    expect(calls()).toBe(1);
    child.replyOk('hello', 'en');
    await expect(p).resolves.toEqual({ text: 'hello', language: 'en' });
    host.shutdown();
  });

  it('resolves text-only replies without a language field', async () => {
    const child = new FakeChild();
    const { fork } = forkFactory([child]);
    const host = new HostClient({ hostPath: '/x/sidecar.js', env: {}, forkImpl: fork });
    const p = host.transcribe(REQ);
    await tick();
    child.replyOk('just text');
    await expect(p).resolves.toEqual({ text: 'just text' });
    host.shutdown();
  });

  it('correlates replies by id and reuses one child across calls', async () => {
    const child = new FakeChild();
    const { fork, calls } = forkFactory([child]);
    const host = new HostClient({ hostPath: '/x/sidecar.js', env: {}, forkImpl: fork });

    const p1 = host.transcribe({ ...REQ, samples: new Float32Array([1]) });
    await tick();
    const p2 = host.transcribe({ ...REQ, samples: new Float32Array([2]) });
    await tick();
    expect(child.sent.map((m) => m.id)).toEqual([1, 2]);
    expect(calls()).toBe(1);
    // Reply out of order — id correlation must still settle each promise.
    child.replyOkTo(2, 'two');
    child.replyOkTo(1, 'one');
    await expect(p1).resolves.toEqual({ text: 'one' });
    await expect(p2).resolves.toEqual({ text: 'two' });
    host.shutdown();
  });

  it('rejects a transcription error reply', async () => {
    const child = new FakeChild();
    const { fork } = forkFactory([child]);
    const host = new HostClient({ hostPath: '/x/sidecar.js', env: {}, forkImpl: fork });
    const p = host.transcribe(REQ);
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

    const p = host.transcribe(REQ);
    await tick();
    expect(calls()).toBe(1);
    first.crash(139); // dies with the request in flight
    await tick();
    expect(calls()).toBe(2);
    second.replyOk('recovered');
    await expect(p).resolves.toEqual({ text: 'recovered' });
    host.shutdown();
  });

  it('gives up after a second consecutive crash', async () => {
    const first = new FakeChild();
    const second = new FakeChild();
    const { fork } = forkFactory([first, second]);
    const host = new HostClient({ hostPath: '/x/sidecar.js', env: {}, forkImpl: fork });
    const p = host.transcribe(REQ);
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
    const p = host.transcribe(REQ);
    await tick();
    child.errorOut('ENOENT node');
    await tick();
    second.replyOk('after respawn');
    await expect(p).resolves.toEqual({ text: 'after respawn' });
    host.shutdown();
  });

  it('times out a hung transcription and kills the child', async () => {
    const child = new FakeChild();
    const { fork } = forkFactory([child]);
    const host = new HostClient({
      hostPath: '/x/sidecar.js',
      env: {},
      forkImpl: fork,
      requestTimeoutMs: 10,
    });
    const p = host.transcribe(REQ);
    await expect(p).rejects.toThrow(/timed out/);
    expect(child.killed).toBe(true);
    host.shutdown();
  });

  it('shutdown kills the child and rejects in-flight requests', async () => {
    const child = new FakeChild();
    const { fork } = forkFactory([child]);
    const host = new HostClient({ hostPath: '/x/sidecar.js', env: {}, forkImpl: fork });
    const p = host.transcribe(REQ);
    await tick();
    host.shutdown();
    expect(child.killed).toBe(true);
    await expect(p).rejects.toThrow(/shut down/);
    // Further calls fail fast.
    await expect(host.transcribe(REQ)).rejects.toThrow(/shut down/);
  });
});
