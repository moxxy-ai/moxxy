import { describe, expect, it } from 'vitest';
import { agentCliLineHint } from './AgentCliLine.js';

describe('the line about the active agent CLI', () => {
  it('names the command that updates it', () => {
    expect(agentCliLineHint({ provider: 'codex-agent', command: 'codex', severity: 'available', action: 'update', text: 'Codex 0.162.1 is out — you have 0.155.1' })).toBe(
      'moxxy agents update codex',
    );
  });

  it('names the command that installs it when it is missing', () => {
    expect(agentCliLineHint({ provider: 'opencode', command: 'opencode', severity: 'required', action: 'install', text: 'OpenCode is not installed' })).toBe(
      'moxxy agents install opencode',
    );
  });
});
