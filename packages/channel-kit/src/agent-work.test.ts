import { describe, expect, it } from 'vitest';
import type { MoxxyEvent } from '@moxxy/sdk';
import { TurnAgentWork, activeAgentName, agentComputerText } from './agent-work.js';

const ev = (partial: Record<string, unknown>): MoxxyEvent => partial as unknown as MoxxyEvent;
const agentCall = (name: string, input: unknown): MoxxyEvent =>
  ev({ type: 'tool_call_requested', callId: name, name, input, executedBy: 'provider' });

describe('TurnAgentWork', () => {
  it('keeps the last app the agent named, even when a later call names none', () => {
    const work = new TurnAgentWork();
    work.accept(agentCall('mcp__computer-use__screenshot', {}));
    expect(work.computerUse).toEqual({ app: null });
    work.accept(agentCall('mcp__computer-use__click', { app: 'Arc' }));
    work.accept(agentCall('mcp__computer-use__screenshot', {}));
    expect(work.computerUse).toEqual({ app: 'Arc' });
    work.accept(agentCall('mcp__cua_repl__js', { code: "cua.getApp('Finder').click()" }));
    expect(work.computerUse).toEqual({ app: 'Finder' });
  });

  it('ignores a failed step-list result', () => {
    const work = new TurnAgentWork();
    work.accept(ev({ type: 'tool_result', callId: 'c1', ok: false, error: { kind: 'threw', message: 'x' } }));
    expect(work.stepList).toBeNull();
    expect(work.isStepListCall('c1')).toBe(false);
  });

  it('forgets everything on reset', () => {
    const work = new TurnAgentWork();
    work.accept(agentCall('mcp__computer-use__click', { app: 'Arc' }));
    work.accept(ev({ type: 'tool_result', callId: 'i', ok: true, output: { mediaType: 'image/png', base64: 'AAAA' } }));
    work.reset();
    expect(work.computerUse).toBeNull();
    expect(work.images).toEqual([]);
  });
});

describe('activeAgentName', () => {
  it('names the agent of the active connection and nothing for a plain provider', () => {
    const providers = [{ name: 'codex-agent', agentName: 'Codex' }, { name: 'anthropic' }];
    expect(activeAgentName({ activeProvider: 'codex-agent', providers })).toBe('Codex');
    expect(activeAgentName({ activeProvider: 'anthropic', providers })).toBeUndefined();
  });
});

describe('agentComputerText', () => {
  it('reads like the desktop and the terminal', () => {
    expect(agentComputerText({ app: 'Arc' }, 'Codex')).toBe('Codex is using your computer · Arc');
    expect(agentComputerText({ app: null }, undefined)).toBe('The agent is using your computer');
  });
});
