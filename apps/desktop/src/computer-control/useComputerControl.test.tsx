import { afterEach, expect, it } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { ComputerControlSnapshot } from '@moxxy/sdk';
import { useComputerControl } from './useComputerControl';

const scope={workspaceId:'ws',sessionId:'session',turnId:'turn'};
const turn=(state:ComputerControlSnapshot['state']):ComputerControlSnapshot=>({sessionId:'session',turnId:'turn',state,windowId:null});
interface Changed {workspaceId:string;turns:ReadonlyArray<ComputerControlSnapshot>}

function installApi(initial:ReadonlyArray<ComputerControlSnapshot>) {
  const calls:Array<{channel:string;args:unknown}>=[];
  const listeners=new Set<(event:Changed)=>void>();
  __setApiOverride({
    invoke:(async(channel:string,args:unknown)=>{
      calls.push({channel,args});
      return channel==='computer.snapshot' ? {workspaceId:'ws',turns:initial} : undefined;
    }) as never,
    subscribe:((event:string,listener:(event:Changed)=>void)=>{
      if (event!=='computer.changed') return ()=>undefined;
      listeners.add(listener);
      return ()=>{ listeners.delete(listener); };
    }) as never,
  } as never);
  return {
    calls,
    reads:()=>calls.filter(call=>call.channel==='computer.snapshot').length,
    listening:()=>listeners.size,
    push:(event:Changed)=>act(()=>{ for (const listener of listeners) listener(event); }),
  };
}

afterEach(()=>{ cleanup(); __setApiOverride(null); });

it('reads the status once, then follows pushed changes instead of polling', async () => {
  const fake=installApi([turn('foreground')]);
  const {result}=renderHook(()=>useComputerControl(scope));
  await waitFor(()=>expect(result.current.view?.label).toBe('Controlling the target window'));
  fake.push({workspaceId:'ws',turns:[turn('paused_by_user')]});
  expect(result.current.view?.label).toBe('Paused by you');
  await new Promise(resolve=>setTimeout(resolve,1200));
  expect(fake.reads()).toBe(1);
});
it('ignores changes pushed for another workspace', async () => {
  const fake=installApi([turn('foreground')]);
  const {result}=renderHook(()=>useComputerControl(scope));
  await waitFor(()=>expect(result.current.view).not.toBeNull());
  fake.push({workspaceId:'other',turns:[turn('stopped')]});
  expect(result.current.view?.label).toBe('Controlling the target window');
});
it('keeps a change that arrives before the first read answers', async () => {
  const fake=installApi([turn('foreground')]);
  const {result}=renderHook(()=>useComputerControl(scope));
  fake.push({workspaceId:'ws',turns:[turn('paused_by_user')]});
  await new Promise(resolve=>setTimeout(resolve,20));
  expect(result.current.view?.label).toBe('Paused by you');
});
it('sends take-over for the watched turn and stops listening once the turn is over', async () => {
  const fake=installApi([turn('foreground')]);
  const {result,rerender}=renderHook(({active})=>useComputerControl(active ? scope : null),{initialProps:{active:true}});
  await waitFor(()=>expect(result.current.view?.canTakeOver).toBe(true));
  await act(()=>result.current.command('takeover'));
  expect(fake.calls.at(-1)).toEqual({channel:'computer.control',args:{...scope,command:'takeover'}});
  rerender({active:false});
  expect(fake.listening()).toBe(0);
  expect(result.current.view).toBeNull();
});
