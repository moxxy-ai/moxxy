import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { defineMode, definePlugin, defineProvider, runReactLoop } from '@moxxy/sdk';
import { Session } from './session.js';
import { collectTurn } from './run-turn.js';

it('records timing on the real session event log using an HTTP provider and lifecycle hooks', async () => {
  const server=createServer((_request,response) => {
    void delay(20).then(() => response.end('Timing fixture response'));
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const address=server.address();
  if (!address || typeof address==='string') throw new Error('HTTP fixture did not bind');
  const session=new Session({silent:true});
  const models=[{id:'timing-fixture',contextWindow:8192,supportsTools:false}];
  session.pluginHost.registerStatic(definePlugin({
    name:'timing-fixture',
    providers:[defineProvider({name:'timing-http',models,createClient:() => ({
      name:'timing-http',models,
      stream:async function* (request) {
        const response=await fetch(`http://127.0.0.1:${address.port}`,{signal:request.signal});
        yield {type:'text_delta' as const,delta:await response.text()};
        yield {type:'message_end' as const,stopReason:'end_turn' as const};
      },
    })})],
    modes:[defineMode({name:'timing-loop',run:ctx => runReactLoop(ctx,{strategyName:'timing-loop'})})],
    hooks:{onBeforeProviderCall:async request => {await delay(10);return request;}},
  }));
  session.providers.setActive('timing-http'); session.modes.setActive('timing-loop');
  try {
    await collectTurn(session,'Read the timing fixture');
    const response=session.log.ofType('provider_response')[0];
    expect(response).toBeDefined();
    const timing=response?.timing;
    expect(timing).toBeDefined();
    if (!timing) throw new Error('Missing persisted timings');
    expect(timing.hooksMs).toBeGreaterThanOrEqual(5);
    expect(timing.providerWaitMs).toBeGreaterThanOrEqual(15);
    expect(timing.firstEventMs).toBeGreaterThanOrEqual(15);
    expect(timing.totalMs).toBeCloseTo(timing.contextProjectionMs+timing.preparationMs+timing.hooksMs+timing.providerWaitMs+timing.consumerMs,5);
    expect(session.log.ofType('assistant_message').at(-1)?.content).toBe('Timing fixture response');
    expect(JSON.parse(JSON.stringify(response)).timing).toEqual(timing);
  } finally {
    await session.close();
    await new Promise<void>((resolve,reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
});
