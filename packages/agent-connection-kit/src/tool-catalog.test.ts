/**
 * Moxxy's tools behind three small ones: the agent sees a short catalog and
 * fetches a tool's description only when it wants the tool, so the full
 * descriptions do not ride along in every request.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool, type AgentStepHost, type AgentToolCall, type Skill } from '@moxxy/sdk';
import { idleToolsHandler, moxxyToolsHandler } from './moxxy-tools.js';

const tool = (name: string, description: string, inputSchema: z.ZodTypeAny = z.object({})) =>
  defineTool({ name, description, inputSchema, handler: async () => 'unused' });

const navigate = tool('browser_navigate', 'Open a web page in the Moxxy browser.', z.object({ url: z.string() }));
const click = tool('browser_click', 'Click an element of the open page.', z.object({ uid: z.string() }));
const recall = tool('recall', 'Search the whole conversation for something said earlier.', z.object({ query: z.string() }));
const sendMail = tool('mcp__gmail__send_message', 'Send an email from the person Gmail account.', z.object({ to: z.string(), body: z.string() }));
const lent = [navigate, click, recall, sendMail];

const signal = () => new AbortController().signal;
const textOf = (result: { content: ReadonlyArray<{ type: string; text?: string }> }) =>
  result.content.flatMap((part) => (part.type === 'text' && part.text ? [part.text] : [])).join('\n');

function recording() {
  const calls: AgentToolCall[] = [];
  const host: Pick<AgentStepHost, 'runTool'> = {
    runTool: async (call) => {
      calls.push(call);
      return { ok: true, output: `ran ${call.name}` };
    },
  };
  return { calls, host };
}

describe("Moxxy's tools as a catalog", () => {
  it('offers three small tools instead of every tool, the skill tool beside them', () => {
    const skills: Skill[] = [{ id: 'deploy' as Skill['id'], path: '/skills/deploy.md', scope: 'user', frontmatter: { name: 'deploy', description: 'Ship the app' }, body: 'Steps' }];
    const handler = idleToolsHandler(lent, skills, { catalog: true });

    expect(handler.list().map((t) => t.name)).toEqual(['find_tools', 'describe_tools', 'call_tool', 'load_skill']);
  });

  it('names every group of tools in the catalog, with how many tools it has', () => {
    const [find] = idleToolsHandler(lent, [], { catalog: true }).list();

    expect(find?.description).toMatch(/browser \(2\): click, navigate/);
    expect(find?.description).toMatch(/gmail \(1\): send_message/);
    expect(find?.description).toMatch(/recall/);
  });

  it('finds the tools whose name or description has the words asked about, best first, running nothing', async () => {
    const { calls, host } = recording();
    const handler = moxxyToolsHandler(lent, host, [], { catalog: true });

    const found = textOf(await handler.call('find_tools', { query: 'send an email' }, signal()));

    expect(found.split('\n')[0]).toMatch(/^mcp__gmail__send_message — Send an email/);
    expect(found).not.toMatch(/browser_click/);
    expect(calls).toEqual([]);
  });

  it("describes the tools asked for with their full description and input schema, and says which it does not know", async () => {
    const handler = idleToolsHandler(lent, [], { catalog: true });

    const described = JSON.parse(textOf(await handler.call('describe_tools', { names: ['browser_navigate', 'nope'] }, signal())));

    expect(described).toEqual({
      tools: [{ name: 'browser_navigate', description: 'Open a web page in the Moxxy browser.', inputSchema: expect.objectContaining({ required: ['url'] }) }],
      unknown: ['nope'],
    });
  });

  it('runs the tool asked for through the turn with its arguments, so the chat shows that tool', async () => {
    const { calls, host } = recording();
    const handler = moxxyToolsHandler(lent, host, [], { catalog: true });

    const result = await handler.call('call_tool', { name: 'browser_navigate', arguments: { url: 'https://example.com' } }, signal());

    expect(textOf(result)).toBe('ran browser_navigate');
    expect(calls).toEqual([expect.objectContaining({ name: 'browser_navigate', input: { url: 'https://example.com' } })]);
  });

  it('runs nothing for a tool the catalog does not have, and tells the agent how to find one', async () => {
    const { calls, host } = recording();
    const handler = moxxyToolsHandler(lent, host, [], { catalog: true });

    const result = await handler.call('call_tool', { name: 'browser_fly', arguments: {} }, signal());

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/find_tools/);
    expect(calls).toEqual([]);
  });

  it("still tells the agent about Moxxy's browser when the catalog holds its tools", () => {
    expect(idleToolsHandler(lent, [], { catalog: true }).instructions).toMatch(/browser panel/);
    expect(idleToolsHandler([recall], [], { catalog: true }).instructions).not.toMatch(/browser/i);
  });

  it('keeps the catalog within the length Claude Code reads of a tool description, however many tools there are', () => {
    const many = Array.from({ length: 400 }, (_, i) => tool(`mcp__server${i % 40}__action_number_${i}`, `Action ${i}.`));
    const [find] = idleToolsHandler(many, [], { catalog: true }).list();

    expect(find?.description.length).toBeLessThanOrEqual(2000);
    expect(find?.description).toMatch(/server39 \(10\)/);
  });

  it('reads the same whatever order the tools were registered in, so the agent prompt cache still matches', () => {
    const list = (tools: typeof lent) => idleToolsHandler(tools, [], { catalog: true }).list();

    expect(list([...lent].reverse())).toEqual(list(lent));
    expect(list([recall, sendMail, click, navigate])).toEqual(list(lent));
  });

  it('offers no catalog when no tool is lent', () => {
    expect(idleToolsHandler([], [], { catalog: true }).list()).toEqual([]);
  });
});
