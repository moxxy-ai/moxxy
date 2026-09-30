import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { HelperTransport, type HelperEvent, type HelperTransportOptions } from './transport.js';

// Real subprocesses exercise pipe framing/lifetime; these do not simulate platform APIs.
const helper = (script: string, options: Partial<HelperTransportOptions> = {}) =>
  new HelperTransport(process.execPath, ['-e', script], { protocolVersion: 4, ...options });
const peer = `process.stdin.once('data', bytes => {
  const request = JSON.parse(bytes.toString());
  process.stdout.write(JSON.stringify({version:4,id:request.id,ok:true,result:{received:request.method}})+'\\n');
});`;
const cursorEvent = z.object({ version: z.literal(4), event: z.literal('cursor'), x: z.number(), y: z.number() }).strict();

describe('native helper transport', () => {
  it('reports the native panel Stop exit as cancellation, not a helper crash', async () => {
    const transport = helper("process.stdin.once('data', () => process.exit(20))");
    try {
      await expect(transport.request('click', {}, new AbortController().signal)).rejects.toThrow('Computer Use stopped by user');
      expect(transport.stoppedByUser).toBe(true);
      await expect(transport.request('click', {}, new AbortController().signal)).rejects.toThrow(/closed/);
    } finally { await transport.close(); }
  });
  it('excludes explicit focus waiting from the active request timeout', async () => {
    const states: string[] = [];
    const transport = helper(`process.stdin.once('data', bytes => {
      const r=JSON.parse(bytes.toString());
      process.stdout.write(JSON.stringify({version:4,event:'control_state',id:r.id,state:'waiting_for_focus'})+'\\n');
      setTimeout(()=>{
        process.stdout.write(JSON.stringify({version:4,event:'control_state',id:r.id,state:'foreground'})+'\\n');
        process.stdout.write(JSON.stringify({version:4,id:r.id,ok:true,result:{delivered:false,status:'needs_observation'}})+'\\n');
      },250);
    });`, { timeoutMs: 150, onEvent: (event) => { if (event.event === 'control_state') states.push(String(event.state)); } });
    try {
      expect(await transport.request('click', {}, new AbortController().signal)).toEqual({delivered:false,status:'needs_observation'});
      expect(states).toEqual(['waiting_for_focus','foreground']);
    } finally { await transport.close(); }
  });
  it('exchanges a correlated frame through real private pipes', async () => {
    const transport = helper(peer);
    try {
      expect(await transport.request('status', {}, new AbortController().signal)).toEqual({ received: 'status' });
    } finally { await transport.close(); }
    expect(transport.closed).toBe(true);
  });
  it('cancels while focus waiting is suspended', async () => {
    const abort = new AbortController();
    const transport = helper(`process.stdin.once('data', bytes => {
      const r=JSON.parse(bytes.toString());
      process.stdout.write(JSON.stringify({version:4,event:'control_state',id:r.id,state:'waiting_for_focus'})+'\\n');
      process.stdin.resume();
    });`, { timeoutMs: 1000, onEvent: () => abort.abort() });
    await expect(transport.request('key', {}, abort.signal)).rejects.toThrow(/cancelled/);
    await transport.close();
    expect(transport.closed).toBe(true);
  });
  it('still times out after focus waiting ends without an operation response', async () => {
    const transport = helper(`process.stdin.once('data', bytes => {
      const r=JSON.parse(bytes.toString());
      const state=s=>process.stdout.write(JSON.stringify({version:4,event:'control_state',id:r.id,state:s})+'\\n');
      state('waiting_for_focus');
      setTimeout(()=>{state('foreground');process.stdin.resume();},200);
    });`, { timeoutMs: 150 });
    await expect(transport.request('key', {}, new AbortController().signal)).rejects.toThrow(/timed out/);
    await transport.close();
  });
  it('rejects a control event for a different request', async () => {
    const transport = helper(`process.stdin.once('data', () => {
      process.stdout.write(JSON.stringify({version:4,event:'control_state',id:'wrong',state:'waiting_for_focus'})+'\\n');
    });`);
    await expect(transport.request('key', {}, new AbortController().signal)).rejects.toThrow(/protocol/);
    await transport.close();
  });
  it('rejects a mismatched protocol and permanently retires the peer', async () => {
    const transport = helper(peer.replace('version:4', 'version:2'));
    await expect(transport.request('status', {}, new AbortController().signal)).rejects.toThrow(/protocol/i);
    await transport.close();
    expect(transport.closed).toBe(true);
  });
  it('speaks the protocol version it was configured with', async () => {
    const transport = new HelperTransport(process.execPath, ['-e', `process.stdin.once('data', bytes => {
      const r=JSON.parse(bytes.toString());
      process.stdout.write(JSON.stringify({version:5,id:r.id,ok:true,result:{sent:r.version}})+'\\n');
    });`], { protocolVersion: 5 });
    try {
      expect(await transport.request('status', {}, new AbortController().signal)).toEqual({ sent: 5 });
    } finally { await transport.close(); }
  });
  it('times out without retrying an ambiguous input operation', async () => {
    const transport = helper('process.stdin.resume()', { timeoutMs: 40 });
    await expect(transport.request('type', {}, new AbortController().signal)).rejects.toThrow(/not retried/);
    await expect(transport.request('type', {}, new AbortController().signal)).rejects.toThrow(/closed/);
    await transport.close();
  });
  it('cancels a real process and refuses already-cancelled requests', async () => {
    const transport = helper('process.stdin.resume()');
    const abort = new AbortController();
    const promise = transport.request('observe', {}, abort.signal);
    abort.abort();
    await expect(promise).rejects.toThrow(/cancel/i);
    await transport.close();
    expect(transport.closed).toBe(true);
  });
  it('reports process death rather than leaving requests pending', async () => {
    const transport = helper('process.exit(3)');
    await expect(transport.request('status', {}, new AbortController().signal)).rejects.toThrow(/exited/);
    await transport.close();
  });
  it('sends resume independently of a pending operation and permanently closes on stop', async () => {
    const transport: HelperTransport = helper(`const lines=require('readline').createInterface({input:process.stdin});
      let request;
      lines.on('line',line=>{const r=JSON.parse(line);
        if(r.method){request=r;process.stdout.write(JSON.stringify({version:4,event:'control_state',id:r.id,state:'paused_by_user'})+'\\n');}
        else if(r.control==='resume'){process.stdout.write(JSON.stringify({version:4,id:request.id,ok:true,result:{resumed:true}})+'\\n');}
      });`, { timeoutMs: 1000, onEvent: (event) => { if (event.state === 'paused_by_user') transport.control('resume'); } });
    expect(await transport.request('click', {}, new AbortController().signal)).toEqual({resumed:true});
    transport.control('stop');
    await expect(transport.request('click', {}, new AbortController().signal)).rejects.toThrow(/closed/);
    await transport.close();
  });
});

describe('helper events', () => {
  it('delivers a registered uncorrelated event without disturbing the pending request', async () => {
    const events: HelperEvent[] = [];
    const transport = helper(`process.stdin.once('data', bytes => {
      const r=JSON.parse(bytes.toString());
      process.stdout.write(JSON.stringify({version:4,event:'cursor',x:10,y:20})+'\\n');
      process.stdout.write(JSON.stringify({version:4,id:r.id,ok:true,result:{clicked:true}})+'\\n');
    });`, { events: { cursor: cursorEvent }, onEvent: (event) => events.push(event) });
    try {
      expect(await transport.request('click', {}, new AbortController().signal)).toEqual({ clicked: true });
      expect(events).toEqual([{ version: 4, event: 'cursor', x: 10, y: 20 }]);
    } finally { await transport.close(); }
  });
  it('delivers events that arrive while no request is pending', async () => {
    const received = new Promise<HelperEvent>((resolve) => {
      const transport = helper(`process.stdout.write(JSON.stringify({version:4,event:'cursor',x:1,y:2})+'\\n'); process.stdin.resume();`,
        { events: { cursor: cursorEvent }, onEvent: (event) => { resolve(event); void transport.close(); } });
    });
    expect(await received).toEqual({ version: 4, event: 'cursor', x: 1, y: 2 });
  });
  it('treats an unregistered or malformed event as a protocol failure', async () => {
    for (const frame of ['{version:4,event:"teleport"}', '{version:4,event:"cursor",x:"left",y:2}']) {
      const transport = helper(`process.stdin.once('data', () => process.stdout.write(JSON.stringify(${frame})+'\\n'));`,
        { events: { cursor: cursorEvent } });
      await expect(transport.request('click', {}, new AbortController().signal)).rejects.toThrow(/protocol/);
      await transport.close();
    }
  });
});
