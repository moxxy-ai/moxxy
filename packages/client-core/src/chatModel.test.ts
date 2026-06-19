/**
 * Chat model tests — drive the runtime directly (no React render) and
 * assert on the folded render tree + streaming/flag state.
 */

import { describe, expect, it } from 'vitest';
import type { MoxxyEvent } from '@moxxy/sdk';
import {
  applyAction,
  applyEvent,
  buildRenderNodes,
  createRuntime,
  groupToolNodes,
  isRenderedEvent,
  registerRenderablePlugin,
  type ChatRuntime,
  type Extension,
  type FoldedBlock,
  type RenderNode,
} from './chatModel.js';
import type { ToolCallBlockData } from '@moxxy/chat-model';

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
    expect(c1!.outcome).toMatchObject({ type: 'tool_result', ok: true });
    expect(c2!.outcome).toBeNull();
  });

  it('carries tool_result error.message through', () => {
    const rt = createRuntime();
    applyEvent(rt, toolReq('c1', 'grep', {}));
    applyEvent(rt, toolRes('c1', false, undefined, { message: 'boom', kind: 'threw' }));
    const tool = blocksOf(rt).find((b): b is Extract<FoldedBlock, { kind: 'tool-call' }> => b.kind === 'tool-call');
    expect(tool!.outcome).toMatchObject({ type: 'tool_result', ok: false, error: { message: 'boom' } });
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
    const id = rt.extensions[0]!.id;
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
    const group = out[0]!;
    expect(group.kind).toBe('tool-group');
    if (group.kind !== 'tool-group') throw new Error('unreachable');
    expect(group.id).toBe(`toolgroup:${(a as { block: ToolCallBlockData }).block.id}`);
    expect(group.tools).toHaveLength(2);
  });

  it('keeps a lone tool as its own block (run of 1 is not grouped)', () => {
    const out = groupToolNodes([toolNode('bash')]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('block');
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
    const group = out[1]!;
    if (group.kind !== 'tool-group') throw new Error('unreachable');
    expect(group.tools).toHaveLength(3);
  });

  it('flushes the run BEFORE an interrupting node, then emits that node', () => {
    const out = groupToolNodes([toolNode('bash'), toolNode('grep'), extNode(), toolNode('ls'), toolNode('cat')]);
    // group(2) + ext + group(2)
    expect(out.map((n) => n.kind)).toEqual(['tool-group', 'ext', 'tool-group']);
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

  it('registerRenderablePlugin opts a plugin in without editing the core module', () => {
    const id = '@moxxy/plugin-author-test';
    expect(isRenderedEvent(pluginEvent(id))).toBe(false);
    registerRenderablePlugin(id);
    expect(isRenderedEvent(pluginEvent(id))).toBe(true);
  });
});
