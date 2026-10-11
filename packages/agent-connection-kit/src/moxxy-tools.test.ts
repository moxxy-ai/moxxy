/**
 * How Moxxy's tools and their results look to a vendor agent over MCP. The
 * host is the turn's real `AgentStepHost` contract; here it is a small stand-in
 * because the loop that implements it is tested in mode-default.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool, type AgentStepHost, type AgentToolCall } from '@moxxy/sdk';
import { idleToolsHandler, mcpToolsFrom, moxxyToolsHandler, sameToolNames, toMcpResult } from './moxxy-tools.js';

describe('a Moxxy tool result handed to the agent', () => {
  it('is text for text and JSON for other values', () => {
    expect(toMcpResult({ ok: true, output: 'done' })).toEqual({ content: [{ type: 'text', text: 'done' }] });
    expect(toMcpResult({ ok: true, output: { n: 1 } })).toEqual({ content: [{ type: 'text', text: '{"n":1}' }] });
  });

  it('is a picture for a screenshot, with its description', () => {
    expect(toMcpResult({ ok: true, output: { mediaType: 'image/png', base64: 'AAA', forModel: 'Screen 1440x900' } })).toEqual({
      content: [
        { type: 'text', text: 'Screen 1440x900' },
        { type: 'image', data: 'AAA', mimeType: 'image/png' },
      ],
    });
  });

  it('is a failure the agent can read when the tool failed or the person refused', () => {
    expect(toMcpResult({ ok: false, message: 'the person said no' })).toEqual({
      content: [{ type: 'text', text: 'the person said no' }],
      isError: true,
    });
  });
});

describe('the Moxxy tools offered to the agent', () => {
  const title = defineTool({
    name: 'browser_title',
    description: 'Read a page title',
    inputSchema: z.object({ url: z.string().describe('The page') }),
    handler: async () => 'unused',
  });

  it('describes each tool with its JSON Schema', () => {
    expect(mcpToolsFrom([title])).toEqual([
      {
        name: 'browser_title',
        description: 'Read a page title',
        inputSchema: expect.objectContaining({ type: 'object', required: ['url'] }),
      },
    ]);
  });

  it('keeps a schema a tool already carries as it is', () => {
    const external = defineTool({
      name: 'from_mcp',
      description: 'A tool from another MCP server',
      inputSchema: z.unknown(),
      inputJsonSchema: { type: 'object', properties: { q: { type: 'string' } } },
      handler: async () => 'unused',
    });

    expect(mcpToolsFrom([external])[0]?.inputSchema).toEqual({ type: 'object', properties: { q: { type: 'string' } } });
  });

  it('runs a tool through the turn, under a fresh call id for each call', async () => {
    const calls: AgentToolCall[] = [];
    const host: Pick<AgentStepHost, 'runTool'> = {
      runTool: async (call) => {
        calls.push(call);
        return { ok: true, output: 'Example Domain' };
      },
    };
    const handler = moxxyToolsHandler([title], host);

    const first = await handler.call('browser_title', { url: 'https://example.com' }, new AbortController().signal);
    await handler.call('browser_title', { url: 'https://example.org' }, new AbortController().signal);

    expect(handler.list().map((t) => t.name)).toEqual(['browser_title']);
    expect(first).toEqual({ content: [{ type: 'text', text: 'Example Domain' }] });
    expect(calls[0]).toMatchObject({ name: 'browser_title', input: { url: 'https://example.com' } });
    expect(calls[0]?.callId).not.toBe(calls[1]?.callId);
  });

  it('keeps the same list between turns and runs nothing then', async () => {
    const handler = idleToolsHandler([title]);

    expect(handler.list().map((t) => t.name)).toEqual(['browser_title']);
    expect(await handler.call('browser_title', {}, new AbortController().signal)).toMatchObject({ isError: true });
  });

  it('tells lists of the same tools from lists that differ', () => {
    const other = { ...title, name: 'other' };

    expect(sameToolNames([title, other], [other, title])).toBe(true);
    expect(sameToolNames([title], [title, other])).toBe(false);
  });
});
