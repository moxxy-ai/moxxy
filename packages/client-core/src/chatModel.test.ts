/**
 * Chat model tests — drive the runtime directly (no React render) and
 * assert on the folded render tree + streaming/flag state.
 */

import { describe, expect, it } from 'vitest';
import { assertDefined, type MoxxyEvent } from '@moxxy/sdk';
import {
  applyAction,
  applyEvent,
  buildRenderNodes,
  createRuntime,
  groupThinkingNodes,
  groupToolNodes,
  groupWorkNodes,
  isRenderedEvent,
  registerRenderablePlugin,
  type ChatRuntime,
  type Extension,
  type FoldedBlock,
  type RenderNode,
} from './chatModel.js';
import { IncrementalFold, type CompactToolMap, type ToolCallBlockData } from '@moxxy/chat-model';

let n = 0;
function evt(type: MoxxyEvent['type'], extra: Record<string, unknown>): MoxxyEvent {
  n += 1;
  return {
    id: `e${n}`,
    seq: n,
    ts: n,
    turnId: 'T1',
    sessionId: 'S',
    source: 'model',
    type,
    ...extra,
  } as unknown as MoxxyEvent;
}
const userPrompt = (text: string): MoxxyEvent => evt('user_prompt', { text });
const chunk = (delta: string): MoxxyEvent => evt('assistant_chunk', { delta });
const assistant = (content: string, stopReason = 'end_turn'): MoxxyEvent =>
  evt('assistant_message', { content, stopReason });
const toolReq = (callId: string, name: string, input: unknown): MoxxyEvent =>
  evt('tool_call_requested', { callId, name, input });
const toolRes = (callId: string, ok: boolean, output?: unknown, error?: unknown): MoxxyEvent =>
  evt('tool_result', {
    callId,
    ok,
    ...(output !== undefined ? { output } : {}),
    ...(error ? { error } : {}),
  });
const errorEvent = (message: string): MoxxyEvent => evt('error', { kind: 'fatal', message });

function blocksOf(rt: ChatRuntime): FoldedBlock[] {
  return buildRenderNodes(rt.log.toArray(), rt.extensions)
    .filter((node): node is { kind: 'block'; block: FoldedBlock } => node.kind === 'block')
    .map((node) => node.block);
}

describe('chat model runtime', () => {
  it('starts empty', () => {
    const rt = createRuntime();
    expect(blocksOf(rt)).toEqual([]);
    expect(rt.sending).toBe(false);
    expect(rt.activeTurnId).toBeNull();
  });

  it('send_started flips sending + activeTurnId without adding a block', () => {
    const rt = createRuntime();
    applyAction(rt, { type: 'send_started', turnId: 'T1' });
    expect(rt.sending).toBe(true);
    expect(rt.activeTurnId).toBe('T1');
    expect(blocksOf(rt)).toEqual([]);
  });

  it('accumulates assistant chunks into streamingText — never into the log (O(1))', () => {
    const rt = createRuntime();
    applyEvent(rt, chunk('hel'));
    applyEvent(rt, chunk('lo'));
    applyEvent(rt, chunk('!'));
    expect(rt.streamingText).toBe('hello!');
    expect(rt.log.length).toBe(0);
    expect(blocksOf(rt)).toEqual([]);
  });

  it('accumulates reasoning chunks into streamingReasoning — never into the log', () => {
    const rt = createRuntime();
    applyEvent(rt, evt('reasoning_chunk', { delta: 'think' }));
    applyEvent(rt, evt('reasoning_chunk', { delta: 'ing…' }));
    expect(rt.streamingReasoning).toBe('thinking…');
    expect(rt.log.length).toBe(0);
  });

  it('commits reasoning_message + clears the live reasoning preview', () => {
    const rt = createRuntime();
    applyEvent(rt, evt('reasoning_chunk', { delta: 'pondering' }));
    applyEvent(rt, evt('reasoning_message', { content: 'pondering' }));
    expect(rt.streamingReasoning).toBe('');
    const blocks = blocksOf(rt);
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as Extract<FoldedBlock, { kind: 'event' }>).event).toMatchObject({
      type: 'reasoning_message',
      content: 'pondering',
    });
  });

  it('assistant_message clears any live reasoning preview too', () => {
    const rt = createRuntime();
    applyEvent(rt, evt('reasoning_chunk', { delta: 'hmm' }));
    applyEvent(rt, assistant('done.', 'end_turn'));
    expect(rt.streamingReasoning).toBe('');
  });

  it('commits the streamed text on assistant_message and clears the stream', () => {
    const rt = createRuntime();
    applyEvent(rt, chunk('hi'));
    applyEvent(rt, assistant('hi.', 'end_turn'));
    expect(rt.streamingText).toBe('');
    const blocks = blocksOf(rt);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'event' });
    const ev = (blocks[0] as Extract<FoldedBlock, { kind: 'event' }>).event;
    expect(ev).toMatchObject({ type: 'assistant_message', content: 'hi.' });
  });

  it('drops a replayed/duplicate event by id (idempotent re-attach)', () => {
    const rt = createRuntime();
    const u = userPrompt('hello');
    const a = assistant('hi.', 'end_turn');
    expect(applyEvent(rt, u)).toBe(true);
    expect(applyEvent(rt, a)).toBe(true);
    expect(rt.log.length).toBe(2);
    // Same ids arrive again (full-history replay on re-attach) → no-ops.
    expect(applyEvent(rt, u)).toBe(false);
    expect(applyEvent(rt, a)).toBe(false);
    expect(rt.log.length).toBe(2);
    expect(blocksOf(rt)).toHaveLength(2);
  });

  it('seeds seenIds from initial events so a replay of them is de-duped', () => {
    const u = userPrompt('seeded');
    const rt = createRuntime([u]);
    expect(rt.log.length).toBe(1);
    expect(applyEvent(rt, u)).toBe(false); // already seeded
    expect(rt.log.length).toBe(1);
  });

  it('dedupes duplicate initial events by id', () => {
    const u = userPrompt('loaded twice');
    const rt = createRuntime([u, { ...u } as MoxxyEvent]);
    expect(rt.log.length).toBe(1);
    expect(blocksOf(rt)).toHaveLength(1);
  });

  it('clear() resets seenIds so the same id can be re-added afterwards', () => {
    const rt = createRuntime();
    const u = userPrompt('x');
    applyEvent(rt, u);
    applyAction(rt, { type: 'clear' });
    expect(rt.log.length).toBe(0);
    expect(applyEvent(rt, u)).toBe(true); // not blocked by a stale seenId
    expect(rt.log.length).toBe(1);
  });

  it('renders a user_prompt event as a user block', () => {
    const rt = createRuntime();
    applyEvent(rt, userPrompt('hello'));
    const blocks = blocksOf(rt);
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as Extract<FoldedBlock, { kind: 'event' }>).event).toMatchObject({
      type: 'user_prompt',
      text: 'hello',
    });
  });

  it('keeps tool calls separate and pairs the result to the right callId', () => {
    const rt = createRuntime();
    applyEvent(rt, toolReq('c1', 'grep', { q: 'foo' }));
    applyEvent(rt, toolReq('c2', 'write', { path: 'x' }));
    applyEvent(rt, toolRes('c1', true, ['hit']));
    const tools = blocksOf(rt).filter((b): b is Extract<FoldedBlock, { kind: 'tool-call' }> => b.kind === 'tool-call');
    expect(tools).toHaveLength(2);
    const c1 = tools.find((t) => t.request.callId === 'c1');
    const c2 = tools.find((t) => t.request.callId === 'c2');
    assertDefined(c1, 'tool call c1 is present');
    assertDefined(c2, 'tool call c2 is present');
    expect(c1.outcome).toMatchObject({ type: 'tool_result', ok: true });
    expect(c2.outcome).toBeNull();
  });

  it('carries tool_result error.message through', () => {
    const rt = createRuntime();
    applyEvent(rt, toolReq('c1', 'grep', {}));
    applyEvent(rt, toolRes('c1', false, undefined, { message: 'boom', kind: 'threw' }));
    const tool = blocksOf(rt).find((b): b is Extract<FoldedBlock, { kind: 'tool-call' }> => b.kind === 'tool-call');
    assertDefined(tool, 'tool-call block is present');
    expect(tool.outcome).toMatchObject({ type: 'tool_result', ok: false, error: { message: 'boom' } });
  });

  it('renders error events as an event block', () => {
    const rt = createRuntime();
    applyEvent(rt, errorEvent('runner crashed'));
    const blocks = blocksOf(rt);
    expect((blocks.at(-1) as Extract<FoldedBlock, { kind: 'event' }>).event).toMatchObject({
      type: 'error',
      message: 'runner crashed',
    });
  });

  it('commits trailing streamed text on turn_complete (provider never sealed it)', () => {
    const rt = createRuntime();
    applyAction(rt, { type: 'send_started', turnId: 'T1' });
    applyEvent(rt, chunk('partial'));
    applyAction(rt, { type: 'turn_complete', turnId: 'T1', error: null });
    expect(rt.streamingText).toBe('');
    expect(rt.sending).toBe(false);
    expect(rt.activeTurnId).toBeNull();
    const last = blocksOf(rt).at(-1) as Extract<FoldedBlock, { kind: 'event' }>;
    expect(last.event).toMatchObject({ type: 'assistant_message', content: 'partial' });
  });

  it('adds an error notice extension when turn_complete carries an error', () => {
    const rt = createRuntime();
    applyAction(rt, { type: 'send_started', turnId: 'T1' });
    applyAction(rt, { type: 'turn_complete', turnId: 'T1', error: 'rate limited' });
    expect(rt.extensions).toHaveLength(1);
    expect(rt.extensions[0]).toMatchObject({ kind: 'notice', tone: 'error', text: 'rate limited' });
  });

  it('clear() resets log, stream, extensions, and flags', () => {
    const rt = createRuntime();
    applyAction(rt, { type: 'send_started', turnId: 'T1' });
    applyEvent(rt, chunk('hi'));
    applyAction(rt, { type: 'action_result', commandName: 'info', argsLine: '', tone: 'info', text: 'x' });
    applyAction(rt, { type: 'clear' });
    expect(blocksOf(rt)).toEqual([]);
    expect(rt.extensions).toEqual([]);
    expect(rt.streamingText).toBe('');
    expect(rt.activeTurnId).toBeNull();
  });

  it('ignores bookkeeping events (provider_request etc.)', () => {
    const rt = createRuntime();
    const changed = applyEvent(rt, evt('provider_request', { provider: 'anthropic' }));
    expect(changed).toBe(false);
    expect(rt.log.length).toBe(0);
  });
});

describe('buildRenderNodes', () => {
  it('interleaves extension cards at their event-count anchor', () => {
    const rt = createRuntime();
    applyEvent(rt, userPrompt('first'));
    // anchor an action_result after 1 event
    applyAction(rt, { type: 'action_result', commandName: 'clear', argsLine: '', tone: 'info', text: '' });
    applyEvent(rt, assistant('second'));
    const nodes = buildRenderNodes(rt.log.toArray(), rt.extensions);
    expect(nodes.map((node) => node.kind)).toEqual(['block', 'ext', 'block']);
  });

  it('dismiss_block removes an extension', () => {
    const rt = createRuntime();
    applyAction(rt, { type: 'action_result', commandName: 'x', argsLine: '', tone: 'info', text: 'y' });
    const ext = rt.extensions[0];
    assertDefined(ext, 'action_result added an extension');
    const id = ext.id;
    const changed = applyAction(rt, { type: 'dismiss_block', blockId: id });
    expect(changed).toBe(true);
    expect(rt.extensions).toEqual([]);
  });

});

// ---------------------------------------------------------------------------
// groupToolNodes — run-collapsing of consecutive standalone tool calls.
// ---------------------------------------------------------------------------

let g = 0;
/** Minimal tool-call block; `name` drives the FILE_DIFF exclusion. */
function toolBlock(name: string): ToolCallBlockData {
  g += 1;
  return {
    kind: 'tool-call',
    id: `tc${g}`,
    request: { type: 'tool_call_requested', name, callId: `call${g}` } as ToolCallBlockData['request'],
    outcome: null,
  };
}
const blockNode = (block: FoldedBlock): RenderNode => ({ kind: 'block', block });
const toolNode = (name: string): RenderNode => blockNode(toolBlock(name));
const eventNode = (): RenderNode =>
  blockNode({
    kind: 'event',
    id: `ev${(g += 1)}`,
    event: { type: 'assistant_message', content: 'x' } as MoxxyEvent,
  });
const extNode = (): RenderNode => ({
  kind: 'ext',
  ext: { kind: 'notice', id: `x${(g += 1)}`, afterCount: 0, tone: 'info', text: 'hi' } as Extension,
});

describe('groupToolNodes', () => {
  it('collapses ≥2 consecutive non-diff tool blocks into one tool-group keyed on the first id', () => {
    const a = toolNode('bash');
    const b = toolNode('grep');
    const out = groupToolNodes([a, b]);
    expect(out).toHaveLength(1);
    const group = out[0];
    assertDefined(group, 'grouping yields at least one node');
    expect(group.kind).toBe('tool-group');
    if (group.kind !== 'tool-group') throw new Error('unreachable');
    expect(group.id).toBe(`toolgroup:${(a as { block: ToolCallBlockData }).block.id}`);
    expect(group.tools).toHaveLength(2);
  });

  it('keeps a lone tool as its own block (run of 1 is not grouped)', () => {
    const out = groupToolNodes([toolNode('bash')]);
    expect(out).toHaveLength(1);
    const node = out[0];
    assertDefined(node, 'grouping yields at least one node');
    expect(node.kind).toBe('block');
  });

  it('never folds a Write/Edit (FILE_DIFF) tool into a group', () => {
    // Two file-edit tools each render as their own inline diff card.
    const out = groupToolNodes([toolNode('Write'), toolNode('Edit')]);
    expect(out.map((n) => n.kind)).toEqual(['block', 'block']);

    // A Write between two bash calls breaks the run on both sides.
    const out2 = groupToolNodes([toolNode('bash'), toolNode('Write'), toolNode('bash')]);
    // bash(lone) + Write(lone) + bash(lone) — no run reaches length 2.
    expect(out2.map((n) => n.kind)).toEqual(['block', 'block', 'block']);
  });

  it('breaks a run on a non-tool node into two singletons', () => {
    const out = groupToolNodes([toolNode('bash'), eventNode(), toolNode('grep')]);
    // tool(lone) + event + tool(lone)
    expect(out.map((n) => n.kind)).toEqual(['block', 'block', 'block']);
  });

  it('flushes a trailing run at the end of the list', () => {
    const out = groupToolNodes([eventNode(), toolNode('bash'), toolNode('grep'), toolNode('ls')]);
    // event + one tool-group of 3
    expect(out.map((n) => n.kind)).toEqual(['block', 'tool-group']);
    const group = out[1];
    assertDefined(group, 'grouping yields a second node');
    if (group.kind !== 'tool-group') throw new Error('unreachable');
    expect(group.tools).toHaveLength(3);
  });

  it('flushes the run BEFORE an interrupting node, then emits that node', () => {
    const out = groupToolNodes([toolNode('bash'), toolNode('grep'), extNode(), toolNode('ls'), toolNode('cat')]);
    // group(2) + ext + group(2)
    expect(out.map((n) => n.kind)).toEqual(['tool-group', 'ext', 'tool-group']);
  });
});

describe('buildRenderNodes compact metadata', () => {
  const compact: CompactToolMap = new Map([
    ['Read', { verb: 'Reading', noun: { one: 'file', other: 'files' }, previewKey: 'file_path' }],
  ]);

  it('folds compact tools into one live activity block on the incremental fast path', () => {
    const events = [
      toolReq('read-1', 'Read', { file_path: 'a.ts' }),
      toolReq('read-2', 'Read', { file_path: 'b.ts' }),
    ];
    const nodes = buildRenderNodes(events, [], new IncrementalFold(compact), compact);
    expect(nodes).toHaveLength(1);
    const node = nodes[0];
    assertDefined(node, 'compact fold yields one node');
    expect(node.kind).toBe('block');
    if (node.kind !== 'block') throw new Error('unreachable');
    expect(node.block.kind).toBe('live-tools');
    if (node.block.kind !== 'live-tools') throw new Error('unreachable');
    expect(node.block.calls).toHaveLength(2);
  });

  it('preserves compact folding when an extension forces the sliced path', () => {
    const events = [toolReq('read-3', 'Read', { file_path: 'c.ts' })];
    const extension: Extension = {
      kind: 'notice',
      id: 'notice-before',
      afterCount: 0,
      tone: 'info',
      text: 'note',
    };
    const nodes = buildRenderNodes(events, [extension], undefined, compact);
    expect(nodes.map((node) => node.kind)).toEqual(['ext', 'block']);
    const blockNode = nodes[1];
    assertDefined(blockNode, 'compact block follows extension');
    if (blockNode.kind !== 'block') throw new Error('unreachable');
    expect(blockNode.block.kind).toBe('live-tools');
  });
});

describe('isRenderedEvent plugin registry seam', () => {
  const pluginEvent = (pluginId: string): MoxxyEvent =>
    evt('plugin_event', { pluginId, subtype: 'x', payload: {} });

  it('renders the seeded first-party plugin ids and rejects unknown ones', () => {
    expect(isRenderedEvent(pluginEvent('@moxxy/subagents'))).toBe(true);
    expect(isRenderedEvent(pluginEvent('@moxxy/mode-collaborative'))).toBe(true);
    expect(isRenderedEvent(pluginEvent('@moxxy/something-else'))).toBe(false);
  });

  it("keeps an agent's account limit in the chat, and none of the connection's other bookkeeping", () => {
    const connection = (subtype: string): MoxxyEvent =>
      evt('plugin_event', { pluginId: '@moxxy/agent-connection', subtype, payload: { provider: 'claude-code', limit: { state: 'near' } } });
    expect(isRenderedEvent(connection('account_limit'))).toBe(true);
    expect(isRenderedEvent(connection('agent_session'))).toBe(false);
  });

  it("keeps the agent's background work, which the Agents panel lists from the chat", () => {
    const connection = (subtype: string): MoxxyEvent => evt('plugin_event', { pluginId: '@moxxy/agent-connection', subtype, payload: {} });
    expect(isRenderedEvent(connection('background_work'))).toBe(true);
    expect(isRenderedEvent(connection('background_work_ended'))).toBe(true);
  });

  it('keeps the note that the agent finished a turn it took up by itself without replying', () => {
    expect(isRenderedEvent(evt('plugin_event', { pluginId: '@moxxy/agent-connection', subtype: 'no_reply', payload: {} }))).toBe(true);
  });

  it('keeps the same empty-completion note on live delivery and history replay', () => {
    const prompt = evt('user_prompt', { text: 'Task finished', origin: { kind: 'agent', name: 'Task finished' } });
    const note = evt('plugin_event', { pluginId: '@moxxy/agent-connection', subtype: 'no_reply', payload: {} });
    const live = createRuntime();
    applyEvent(live, prompt);
    applyEvent(live, note);
    applyEvent(live, note);

    expect(blocksOf(live)).toEqual(blocksOf(createRuntime([prompt, note])));
    expect(blocksOf(live)).toHaveLength(2);
    expect(blocksOf(live)[1]).toMatchObject({ kind: 'event', event: note });
  });

  it('registerRenderablePlugin opts a plugin in without editing the core module', () => {
    const id = '@moxxy/plugin-author-test';
    expect(isRenderedEvent(pluginEvent(id))).toBe(false);
    registerRenderablePlugin(id);
    expect(isRenderedEvent(pluginEvent(id))).toBe(true);
  });
});

describe('groupThinkingNodes', () => {
  const thinking = (): RenderNode =>
    blockNode({
      kind: 'event',
      id: `th${(g += 1)}`,
      event: { type: 'reasoning_message', id: `th${g}`, content: 'hmm' } as unknown as MoxxyEvent,
    });

  it('folds thinking one after another into one node keyed on the first, in order', () => {
    const [a, b, c] = [thinking(), thinking(), thinking()];
    const out = groupThinkingNodes([eventNode(), a, b, c, toolNode('bash')]);
    expect(out.map((node) => node.kind)).toEqual(['block', 'thinking', 'block']);
    const group = out[1];
    if (group?.kind !== 'thinking') throw new Error('expected a thinking node');
    expect(group.id).toBe(`thinking:${(a as { block: FoldedBlock }).block.id}`);
    expect(group.events.map((event) => event.id)).toEqual([a, b, c].map((node) => (node as { block: FoldedBlock }).block.id));
  });

  it('leaves a lone thinking, and thinking a tool comes between, as they are', () => {
    const out = groupThinkingNodes([thinking(), toolNode('bash'), thinking()]);
    expect(out.map((node) => node.kind)).toEqual(['block', 'block', 'block']);
  });
});

describe('groupWorkNodes', () => {
  const at = (type: MoxxyEvent['type'], ts: number, extra: Record<string, unknown> = {}): RenderNode =>
    blockNode({ kind: 'event', id: `w${(g += 1)}`, event: { type, id: `w${g}`, ts, ...extra } as unknown as MoxxyEvent });
  const prompt = (ts: number): RenderNode => at('user_prompt', ts, { text: 'do it' });
  const said = (ts: number): RenderNode => at('assistant_message', ts, { content: 'on it' });
  const thought = (ts: number): RenderNode => at('reasoning_message', ts, { content: 'hmm' });
  const tool = (ts: number): RenderNode => {
    const block = toolBlock('bash');
    return blockNode({ ...block, request: { ...block.request, ts } as ToolCallBlockData['request'] });
  };
  const tools = (ts: number): RenderNode => ({
    kind: 'tool-group',
    id: `toolgroup:${(g += 1)}`,
    tools: [toolBlock('bash'), toolBlock('grep'), toolBlock('read')].map((block) => ({
      ...block,
      request: { ...block.request, ts } as ToolCallBlockData['request'],
    })),
  });
  const kinds = (nodes: ReadonlyArray<RenderNode>): string[] => nodes.map((node) => node.kind);
  const work = (node: RenderNode | undefined) => {
    if (node?.kind !== 'work') throw new Error(`expected a work node, got ${node?.kind}`);
    return node;
  };

  it('folds what a finished turn did before its answer into one group, the answer left under it', () => {
    const steps = [thought(110), said(120), tools(130), said(150)];
    const answer = said(400);
    const out = groupWorkNodes([prompt(100), ...steps, answer]);
    expect(kinds(out)).toEqual(['block', 'work', 'block']);
    const group = work(out[1]);
    expect(group.nodes).toEqual(steps);
    expect(group.id).toBe(`work:${(steps[0] as { block: FoldedBlock }).block.id}`);
    expect(group.steps).toBe(6);
    expect(group.startedAtMs).toBe(100);
    expect(group.endedAtMs).toBe(400);
    expect(out[2]).toBe(answer);
  });

  it('folds each turn on its own', () => {
    const out = groupWorkNodes([prompt(1), thought(2), tool(3), said(4), prompt(5), tool(6), tool(7), said(8)]);
    expect(kinds(out)).toEqual(['block', 'work', 'block', 'block', 'work', 'block']);
    expect(work(out[4]).startedAtMs).toBe(5);
  });

  it('leaves the turn still running as it is, and the turns before it folded', () => {
    const running = [prompt(5), thought(6), tool(7), said(8)];
    const out = groupWorkNodes([prompt(1), thought(2), tool(3), said(4), ...running], { running: true });
    expect(kinds(out)).toEqual(['block', 'work', 'block', ...running.map(() => 'block')]);
    expect(out.slice(3)).toEqual(running);
  });

  it('keeps errors, Stopped, notices, answered questions and what the surface asks for in view, in order', () => {
    const error = at('error', 5, { message: 'boom' });
    const stopped = at('abort', 9, { reason: 'user' });
    const plan = said(7);
    const notice = extNode();
    const question = toolBlock('ask');
    const answered = blockNode({
      ...question,
      outcome: {
        type: 'tool_result',
        ok: true,
        output: { display: { kind: 'question-answer', questions: [{ question: 'which?', chosen: ['a'] }] } },
      } as unknown as ToolCallBlockData['outcome'],
    });
    const nodes = [prompt(1), thought(2), tool(3), error, tool(6), tool(6), plan, notice, answered, said(8), tool(8), stopped];
    const out = groupWorkNodes(nodes, { keep: (node) => node === plan });
    expect(kinds(out)).toEqual(['block', 'work', 'block', 'work', 'block', 'ext', 'block', 'block', 'block', 'block']);
    expect(work(out[1]).endedAtMs).toBe(5);
    expect(out.slice(4)).toEqual([plan, notice, answered, ...nodes.slice(9)]);
  });

  it('does not make a group of one step, nor fold rows before the first message', () => {
    const before = [thought(1), tool(2), said(3)];
    const turn = [prompt(4), tool(5), said(6)];
    expect(groupWorkNodes([...before, ...turn])).toEqual([...before, ...turn]);
  });
});
