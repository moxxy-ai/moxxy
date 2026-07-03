import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { SignalRpcClient, type RpcStream } from './jsonrpc.js';

class FakeStream extends EventEmitter implements RpcStream {
  written: string[] = [];
  ended = false;
  write(data: string): boolean {
    this.written.push(data);
    return true;
  }
  end(): void {
    this.ended = true;
  }
  /** Feed one raw chunk into the client. */
  feed(raw: string): void {
    this.emit('data', Buffer.from(raw, 'utf8'));
  }
  lastRequest(): { id: string; method: string; params: unknown } {
    return JSON.parse(this.written.at(-1)!) as { id: string; method: string; params: unknown };
  }
}

describe('SignalRpcClient', () => {
  it('matches responses to requests by id', async () => {
    const stream = new FakeStream();
    const client = new SignalRpcClient({ stream });
    const p = client.request('send', { message: 'hi' });
    const req = stream.lastRequest();
    expect(req.method).toBe('send');
    stream.feed(`{"jsonrpc":"2.0","id":"${req.id}","result":{"timestamp":42}}\n`);
    await expect(p).resolves.toEqual({ timestamp: 42 });
  });

  it('rejects on a JSON-RPC error reply', async () => {
    const stream = new FakeStream();
    const client = new SignalRpcClient({ stream });
    const p = client.request('send', {});
    const req = stream.lastRequest();
    stream.feed(`{"jsonrpc":"2.0","id":"${req.id}","error":{"code":-32602,"message":"bad params"}}\n`);
    await expect(p).rejects.toThrow(/bad params/);
  });

  it('dispatches notifications to subscribers and survives listener throw', () => {
    const stream = new FakeStream();
    const client = new SignalRpcClient({ stream });
    const seen: unknown[] = [];
    client.onNotification('receive', () => {
      throw new Error('boom');
    });
    client.onNotification('receive', (params) => seen.push(params));
    stream.feed('{"jsonrpc":"2.0","method":"receive","params":{"envelope":{"sourceNumber":"+1"}}}\n');
    expect(seen).toEqual([{ envelope: { sourceNumber: '+1' } }]);
  });

  it('handles split + coalesced frames', async () => {
    const stream = new FakeStream();
    const client = new SignalRpcClient({ stream });
    const p1 = client.request('a');
    const p2 = client.request('b');
    const id1 = JSON.parse(stream.written[0]!).id as string;
    const id2 = JSON.parse(stream.written[1]!).id as string;
    const line1 = `{"jsonrpc":"2.0","id":"${id1}","result":1}\n`;
    const line2 = `{"jsonrpc":"2.0","id":"${id2}","result":2}\n`;
    const combined = line1 + line2;
    stream.feed(combined.slice(0, 10));
    stream.feed(combined.slice(10));
    await expect(p1).resolves.toBe(1);
    await expect(p2).resolves.toBe(2);
  });

  it('times out a request the daemon never answers', async () => {
    vi.useFakeTimers();
    try {
      const stream = new FakeStream();
      const client = new SignalRpcClient({ stream, requestTimeoutMs: 500 });
      const p = client.request('version');
      const assertion = expect(p).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(600);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects pending requests when the stream closes', async () => {
    const stream = new FakeStream();
    const client = new SignalRpcClient({ stream });
    const p = client.request('version');
    stream.emit('close');
    await expect(p).rejects.toThrow(/socket closed/);
    await expect(client.request('version')).rejects.toThrow(/closed/);
  });

  it('notifies onClose listeners with the reason', () => {
    const stream = new FakeStream();
    const client = new SignalRpcClient({ stream });
    const reasons: string[] = [];
    client.onClose((r) => reasons.push(r));
    stream.emit('error', new Error('ECONNRESET'));
    expect(reasons).toEqual(['socket error: ECONNRESET']);
  });

  it('drops an oversized un-delimited line instead of buffering forever', () => {
    const warn = vi.fn();
    const stream = new FakeStream();
    const client = new SignalRpcClient({ stream, logger: { warn } });
    stream.feed('x'.repeat(9 * 1024 * 1024)); // > 8MB cap, no newline
    expect(warn).toHaveBeenCalledWith(
      'signal rpc: dropped oversized un-delimited line',
      expect.objectContaining({ bytes: expect.any(Number) }),
    );
    // Client still works afterwards.
    const p = client.request('version');
    const req = stream.lastRequest();
    stream.feed(`{"jsonrpc":"2.0","id":"${req.id}","result":"ok"}\n`);
    return expect(p).resolves.toBe('ok');
  });

  it('ignores garbage lines and unknown ids', () => {
    const stream = new FakeStream();
    const client = new SignalRpcClient({ stream });
    stream.feed('not json\n');
    stream.feed('{"jsonrpc":"2.0","id":"999","result":1}\n');
    // No throw — and the client still accepts requests.
    void client;
  });
});
