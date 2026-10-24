import { describe, expect, it } from 'vitest';
import { agentComputerUseOf } from './agent-computer-use.js';

describe("an agent's own tool call that controls the computer", () => {
  it('is a call to a computer-use MCP server, with the app it names', () => {
    expect(agentComputerUseOf('mcp__computer-use__click', { app: 'Arc', element_index: '185' })).toEqual({ app: 'Arc' });
    expect(agentComputerUseOf('mcp__computer-use__list_apps', {})).toEqual({ app: null });
    expect(agentComputerUseOf('mcp__computer_use__screenshot', { app: 'Safari' })).toEqual({ app: 'Safari' });
    expect(agentComputerUseOf('computer-use_click', { app: 'Notes' })).toEqual({ app: 'Notes' });
  });

  it("is Codex's computer JavaScript, with the app the code opens", () => {
    expect(agentComputerUseOf('mcp__cua_repl__js', { code: "const app = await cua.getApp('Electron'); await app.getAXState();" })).toEqual({ app: 'Electron' });
    expect(agentComputerUseOf('mcp__cua_repl__js', { code: 'await cua.getState();' })).toEqual({ app: null });
  });

  it("is not Codex's own browser, which does not touch the person's apps", () => {
    expect(agentComputerUseOf('mcp__cua_repl__js', { code: "const tab = await cua.createBrowserTab('https://example.com');" })).toBeUndefined();
  });

  it('is not any other tool', () => {
    expect(agentComputerUseOf('Bash', { command: 'open -a Safari' })).toBeUndefined();
    expect(agentComputerUseOf('mcp__docs__search', { app: 'Arc' })).toBeUndefined();
    expect(agentComputerUseOf('computer_click', { app: 'Arc' })).toBeUndefined();
  });
});
