import { describe, expect, it } from 'vitest';
import { HelperTransport } from './transport.js';

// Real subprocesses exercise pipe framing/lifetime; these do not simulate Windows APIs.
const peer = `process.stdin.once('data', bytes => {
  const request = JSON.parse(bytes.toString());
  process.stdout.write(JSON.stringify({version:1,id:request.id,ok:true,result:{received:request.method}})+'\\n');
});`;
describe('native helper transport', () => {
  it('exchanges a correlated frame through real private pipes', async () => {
    const transport = new HelperTransport(process.execPath, ['-e', peer]);
    try {
      expect(await transport.request('status', {}, new AbortController().signal)).toEqual({ received: 'status' });
    } finally { await transport.close(); }
    expect(transport.closed).toBe(true);
  });
  it('rejects a mismatched protocol and permanently retires the peer', async () => {
    const transport = new HelperTransport(process.execPath, ['-e', peer.replace('version:1', 'version:2')]);
    await expect(transport.request('status', {}, new AbortController().signal)).rejects.toThrow(/protocol/i);
    await transport.close();
    expect(transport.closed).toBe(true);
  });
  it('times out without retrying an ambiguous input operation', async () => {
    const transport = new HelperTransport(process.execPath, ['-e', 'process.stdin.resume()'], 40);
    await expect(transport.request('type', {}, new AbortController().signal)).rejects.toThrow(/not retried/);
    await expect(transport.request('type', {}, new AbortController().signal)).rejects.toThrow(/closed/);
    await transport.close();
  });
  it('cancels a real process and refuses already-cancelled requests', async () => {
    const transport = new HelperTransport(process.execPath, ['-e', 'process.stdin.resume()']);
    const abort = new AbortController();
    const promise = transport.request('observe', {}, abort.signal);
    abort.abort();
    await expect(promise).rejects.toThrow(/cancel/i);
    await transport.close();
    expect(transport.closed).toBe(true);
  });
  it('reports process death rather than leaving requests pending', async () => {
    const transport = new HelperTransport(process.execPath, ['-e', 'process.exit(3)']);
    await expect(transport.request('status', {}, new AbortController().signal)).rejects.toThrow(/exited/);
    await transport.close();
  });
});
