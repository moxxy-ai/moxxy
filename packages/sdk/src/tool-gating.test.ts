import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from './define.js';
import type { MoxxyEvent, MoxxyEventOfType, MoxxyEventType } from './events.js';
import { asEventId, asSessionId, asToolCallId, asTurnId, type TurnId } from './ids.js';
import type { EventLogReader } from './log.js';
import type { ProviderMessage } from './provider.js';
import { LAZY_TOOLS_AUTO_THRESHOLD, applyLazyTools, matchLoadableTools, shouldGateTools } from './tool-gating.js';

const mk = (name: string) => defineTool({ name, description: `desc ${name}`, inputSchema: z.object({}), handler: () => '' });
const messages: ProviderMessage[] = [{ role: 'system', content: [{ type: 'text', text: 'sys' }] }];
const systemText = (out: ReadonlyArray<ProviderMessage>) => (out[0]?.content[0] as { text: string }).text;

function logOfLoads(...names: string[]): EventLogReader {
  const events = names.map((name, seq) => ({
    id: asEventId(`e${seq}`), seq, ts: seq, sessionId: asSessionId('s'), turnId: asTurnId('t'), source: 'model',
    type: 'tool_call_requested', callId: asToolCallId(`c${seq}`), name: 'load_tool', input: { name },
  }) as MoxxyEvent);
  return {
    length: events.length,
    at: (seq) => events[seq],
    slice: (from = 0, to = events.length) => events.slice(from, to),
    ofType: <T extends MoxxyEventType>(type: T): ReadonlyArray<MoxxyEventOfType<T>> => events.filter((e): e is MoxxyEventOfType<T> => e.type === type),
    byTurn: (turnId: TurnId) => events.filter((e) => e.turnId === turnId),
    toJSON: () => events,
  };
}

const computer = ['computer_status', 'computer_click', 'computer_drag', 'computer_zoom'].map(mk);
const zoho = ['mcp__zoho__list', 'mcp__zoho__get', 'mcp__zoho__add', 'mcp__zoho__drop'].map(mk);

describe('tool families', () => {
  it('lists a family of tools as one line that names how to load all of it', () => {
    const { messages: out, tools } = applyLazyTools(messages, [mk('Read'), ...computer, mk('web_fetch')], logOfLoads());
    expect(tools.map((t) => t.name)).toEqual(['Read']);
    const text = systemText(out);
    expect(text).toContain('- **computer_*** (4 tools: computer_status, computer_click, computer_drag, computer_zoom)');
    expect(text).toContain('load_tool({ name: "computer_*" })');
    expect(text).toContain('- **web_fetch** — desc web_fetch');
    expect(text).not.toContain('desc computer_click');
  });

  it('groups tools of one MCP server by the server, not by "mcp"', () => {
    const text = systemText(applyLazyTools(messages, [...zoho, mk('mcp__mail__send')], logOfLoads()).messages);
    expect(text).toContain('- **mcp__zoho__*** (4 tools: ');
    expect(text).toContain('- **mcp__mail__send** — ');
  });

  it('loads the whole family from one load_tool call, and leaves other families indexed', () => {
    const { messages: out, tools } = applyLazyTools(messages, [mk('Read'), ...computer, ...zoho], logOfLoads('computer_*'));
    expect(tools.map((t) => t.name)).toEqual(['Read', ...computer.map((t) => t.name)]);
    expect(systemText(out)).not.toContain('computer_click');
    expect(systemText(out)).toContain('mcp__zoho__*');
  });

  it('sends a tool marked always loaded in full, and indexes the rest of its family', () => {
    const run = defineTool({ name: 'computer_run', description: 'desc computer_run', inputSchema: z.object({}), alwaysLoaded: true, handler: () => '' });
    const { messages: out, tools } = applyLazyTools(messages, [mk('Read'), run, ...computer], logOfLoads());
    expect(tools.map((t) => t.name)).toEqual(['Read', 'computer_run']);
    expect(systemText(out)).toContain('- **computer_*** (4 tools: computer_status, computer_click, computer_drag, computer_zoom)');
  });

  it('resolves what a load_tool name stands for', () => {
    const all = [...computer, ...zoho];
    expect(matchLoadableTools('computer_*', all).map((t) => t.name)).toEqual(computer.map((t) => t.name));
    expect(matchLoadableTools('computer_click', all).map((t) => t.name)).toEqual(['computer_click']);
    expect(matchLoadableTools('nothing_*', all)).toEqual([]);
  });
});

describe('shouldGateTools', () => {
  it('follows an explicit setting', () => {
    expect(shouldGateTools(true, 3)).toBe(true);
    expect(shouldGateTools(false, 5000)).toBe(false);
  });

  it('turns itself on when nothing is set and the tool list is long', () => {
    expect(shouldGateTools(undefined, LAZY_TOOLS_AUTO_THRESHOLD)).toBe(false);
    expect(shouldGateTools(undefined, LAZY_TOOLS_AUTO_THRESHOLD + 1)).toBe(true);
  });
});
