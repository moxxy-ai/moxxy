import { describe, expect, it } from 'vitest';
import { HelperTransport } from './transport.js';

// Real subprocesses exercise pipe framing/lifetime; these do not simulate Windows APIs.
const peer = `process.stdin.once('data', bytes => {
  const request = JSON.parse(bytes.toString());
  process.stdout.write(JSON.stringify({version:2,id:request.id,ok:true,result:{received:request.method}})+'\\n');
});`;
describe('native helper transport', () => {
  it('excludes explicit focus waiting from the active request timeout', async () => {
    const states: string[] = [];
    const transport = new HelperTransport(process.execPath, ['-e', `process.stdin.once('data', bytes => {
      const r=JSON.parse(bytes.toString());
      process.stdout.write(JSON.stringify({version:2,event:'control_state',id:r.id,state:'waiting_for_focus'})+'\\n');
      setTimeout(()=>{
        process.stdout.write(JSON.stringify({version:2,event:'control_state',id:r.id,state:'foreground'})+'\\n');
        process.stdout.write(JSON.stringify({version:2,id:r.id,ok:true,result:{delivered:false,status:'needs_observation'}})+'\\n');
      },250);
    });`], 150, state => states.push(state.state));
    try {
      expect(await transport.request('click', {}, new AbortController().signal)).toEqual({delivered:false,status:'needs_observation'});
      expect(states).toEqual(['waiting_for_focus','foreground']);
    } finally { await transport.close(); }
  });
  it('exchanges a correlated frame through real private pipes', async () => {
    const transport = new HelperTransport(process.execPath, ['-e', peer]);
    try {
      expect(await transport.request('status', {}, new AbortController().signal)).toEqual({ received: 'status' });
    } finally { await transport.close(); }
    expect(transport.closed).toBe(true);
  });
  it('cancels while focus waiting is suspended', async () => {
    const abort = new AbortController();
    const transport = new HelperTransport(process.execPath, ['-e', `process.stdin.once('data', bytes => {
      const r=JSON.parse(bytes.toString());
      process.stdout.write(JSON.stringify({version:2,event:'control_state',id:r.id,state:'waiting_for_focus'})+'\\n');
      process.stdin.resume();
    });`], 1000, () => abort.abort());
    await expect(transport.request('key', {}, abort.signal)).rejects.toThrow(/cancelled/);
    await transport.close();
    expect(transport.closed).toBe(true);
  });
  it('still times out after focus waiting ends without an operation response', async () => {
    const transport = new HelperTransport(process.execPath, ['-e', `process.stdin.once('data', bytes => {
      const r=JSON.parse(bytes.toString());
      const state=s=>process.stdout.write(JSON.stringify({version:2,event:'control_state',id:r.id,state:s})+'\\n');
      state('waiting_for_focus');
      setTimeout(()=>{state('foreground');process.stdin.resume();},200);
    });`], 150);
    await expect(transport.request('key', {}, new AbortController().signal)).rejects.toThrow(/timed out/);
    await transport.close();
  });
  it('rejects a control event for a different request', async () => {
    const transport = new HelperTransport(process.execPath, ['-e', `process.stdin.once('data', () => {
      process.stdout.write(JSON.stringify({version:2,event:'control_state',id:'wrong',state:'waiting_for_focus'})+'\\n');
    });`]);
    await expect(transport.request('key', {}, new AbortController().signal)).rejects.toThrow(/protocol/);
    await transport.close();
  });
  it('rejects a mismatched protocol and permanently retires the peer', async () => {
    const transport = new HelperTransport(process.execPath, ['-e', peer.replace('version:2', 'version:1')]);
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
