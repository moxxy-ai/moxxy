import { describe, expect, it } from 'vitest';
import { agentComputerText } from './AgentComputerLine.js';

describe('the line saying an agent is using the computer', () => {
  it('names the agent and the app', () => {
    expect(agentComputerText({ app: 'Arc' }, 'Codex')).toBe('Codex is using your computer · Arc');
  });

  it('still reads when neither is known', () => {
    expect(agentComputerText({ app: null }, undefined)).toBe('The agent is using your computer');
  });
});
