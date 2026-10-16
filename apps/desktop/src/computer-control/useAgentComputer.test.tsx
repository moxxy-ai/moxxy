import { render, screen, fireEvent } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { MoxxyEvent } from '@moxxy/sdk';
import { ComputerControlStrip } from './ComputerControlStrip';
import { useAgentComputer } from './useAgentComputer';

let seq=0;
const event=(over:Record<string,unknown>):MoxxyEvent=>({id:`e${++seq}`,seq,ts:seq,sessionId:'s1',turnId:'t1',...over}) as unknown as MoxxyEvent;
const turn=[
  event({type:'user_prompt',source:'user',text:'book a table'}),
  event({type:'tool_call_requested',source:'model',callId:'c1',name:'mcp__computer-use__click',input:{app:'Arc'},executedBy:'provider'}),
];

it("says which agent is using the computer and in which app, and Stop stops the agent's turn", () => {
  const {result}=renderHook(()=>useAgentComputer(turn,true,'Codex'));
  const view=result.current;
  if (!view) throw new Error('no strip');
  const stops:string[]=[];
  render(<ComputerControlStrip view={view} busy={false} error={null} onCommand={command=>stops.push(command)} />);

  expect(screen.getByRole('status')).toHaveTextContent('Codex is using your computer');
  expect(screen.getByText('Arc')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/Take over/})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Stop Codex'}));
  expect(stops).toEqual(['stop']);
});

it('goes once the turn ends', () => {
  const {result}=renderHook(()=>useAgentComputer(turn,false,'Codex'));
  expect(result.current).toBeNull();
});
