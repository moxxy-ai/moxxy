import { describe, expect, it } from 'vitest';
import {
  asEventId,
  asSessionId,
  asToolCallId,
  asTurnId,
  type MoxxyEvent,
  type ToolCallRequestedEvent,
  type UserPromptEvent,
} from '@moxxy/sdk';
import { turnComputerUse } from './agent-computer.js';

let seq = 0;
const base = () => {
  seq += 1;
  return { id: asEventId(`e${seq}`), seq, ts: seq, sessionId: asSessionId('s1'), turnId: asTurnId('t1') } as const;
};
const prompt = (text: string, checkpoint = false): UserPromptEvent => ({
  ...base(),
  type: 'user_prompt',
  source: checkpoint ? 'system' : 'user',
  text,
  ...(checkpoint ? { origin: { kind: 'checkpoint', name: 'lint' } as const } : {}),
});
const call = (name: string, input: unknown, byAgent = true): ToolCallRequestedEvent => ({
  ...base(),
  type: 'tool_call_requested',
  source: 'model',
  callId: asToolCallId(`c${seq}`),
  name,
  input,
  ...(byAgent ? { executedBy: 'provider' as const } : {}),
});

describe('whether the agent is using the computer in the running turn', () => {
  it('says so from its first computer call, naming the last app it used', () => {
    const events: MoxxyEvent[] = [prompt('book it'), call('Bash', { command: 'ls' })];
    expect(turnComputerUse(events)).toBeNull();

    events.push(call('mcp__computer-use__list_apps', {}));
    expect(turnComputerUse(events)).toEqual({ app: null });

    events.push(call('mcp__computer-use__click', { app: 'Arc' }), call('mcp__computer-use__list_apps', {}));
    expect(turnComputerUse(events)).toEqual({ app: 'Arc' });
  });

  it('keeps saying so through a checkpoint, and stops once the person writes again', () => {
    const before = [prompt('book it'), call('mcp__computer-use__click', { app: 'Arc' })];

    expect(turnComputerUse([...before, prompt('lint', true)])).toEqual({ app: 'Arc' });
    expect(turnComputerUse([...before, prompt('thanks')])).toBeNull();
  });

  it("leaves Moxxy's own tools to Moxxy's own computer strip", () => {
    expect(turnComputerUse([prompt('look'), call('mcp__computer-use__click', { app: 'Arc' }, false)])).toBeNull();
  });
});
