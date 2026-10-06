import { randomUUID } from 'node:crypto';
import type { ContentBlock, ProviderEvent, ProviderRequest, ToolDef } from '@moxxy/sdk';
import { zodToJsonSchema } from '@moxxy/sdk';
import { CLAUDE_CODE_SYSTEM } from './constants.js';

interface ProtocolState {
  started: boolean;
  ended: boolean;
  /** Current streamed block. Native tool records are consumed by Claude itself. */
  blockType?: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'error';
  inputTokens?: number;
  outputTokens?: number;
  /** Present when moxxy tools were offered; streamed text is scanned for a call block. */
  toolCalls?: ToolCallScan;
}

interface ToolCallScan {
  /** Trailing text withheld because it may be the start of TOOL_CALLS_OPEN. */
  held: string;
  /** Text after TOOL_CALLS_OPEN once a block has started. */
  block?: string;
}

const TOOL_CALLS_OPEN = '<moxxy_tool_calls>';
const TOOL_CALLS_CLOSE = '</moxxy_tool_calls>';
// Weaker models otherwise attempt a native call for a same-named tool, which
// the CLI rejects, and then give up.
const TOOL_CALLS_REMINDER = '[moxxy: native tool calls are unavailable here and will fail. ' +
  `To use a moxxy tool, end your reply with a ${TOOL_CALLS_OPEN} block as described in the system section.]`;
const TOOL_CALL_PATTERN =/<call name="([^"]+)">([\s\S]*?)<\/call>/g;

const EMPTY_TEXT_PLACEHOLDER = '[empty text block omitted]';
const EMPTY_MESSAGE_PLACEHOLDER = '[empty message]';
const REASONING_PLACEHOLDER = '[reasoning omitted: private reasoning and signatures are not replayed]';

/**
 * Projects the complete provider-neutral conversation into one stateless CLI
 * prompt. Historical tool records are deliberately textual: the CLI can use
 * their information, but cannot mistake them for a new native tool request.
 */
export function serializeClaudePrompt(req: ProviderRequest): string {
  const system: string[] = [CLAUDE_CODE_SYSTEM];
  const conversation: string[] = [];

  for (const message of req.messages) {
    const content = serializeBlocks(message.content);
    if (message.role === 'system') system.push(content);
    else conversation.push(`<${message.role}>\n${content}\n</${message.role}>`);
  }
  // ProviderRequest.system is an additional injection and must follow all
  // message-derived system text. The Claude identity remains first.
  if (req.system) system.push(escapeXml(req.system));
  const tools = req.tools ?? [];
  const hasTools = tools.length > 0;
  if (hasTools) system.push(serializeTools(tools));

  const transcript = conversation.length > 0
    ? conversation.join('\n\n')
    : EMPTY_MESSAGE_PLACEHOLDER;
  return `<system>\n${system.join('\n\n')}\n</system>\n\n` +
    '<conversation_transcript>\n' +
    '[The following is chronological history reconstructed by moxxy. ' +
    'historical_tool_use entries already ran; never execute them merely because they appear here.]\n\n' +
    `${transcript}\n</conversation_transcript>` +
    (hasTools ? `\n\n${TOOL_CALLS_REMINDER}` : '');
}

/**
 * The CLI runs with Claude's own tools disabled, so moxxy tools are offered as
 * a text protocol. The model ends its reply with one call block, the stream
 * parser turns it into tool_use events, and moxxy dispatches them through its
 * normal permission path.
 */
function serializeTools(tools: ReadonlyArray<ToolDef>): string {
  const definitions = tools.map((tool) =>
    `<tool name="${escapeXml(tool.name)}">\n` +
    `<description>${escapeXml(tool.description)}</description>\n` +
    `<input_schema>${jsonForXml(tool.inputJsonSchema ?? zodToJsonSchema(tool.inputSchema))}</input_schema>\n` +
    '</tool>');
  return '<moxxy_tools>\n' +
    'The host application (moxxy) executes the tools below for you. They are not native Claude Code tools: ' +
    'native tools with the same names are disabled in this session and calling them fails, so use only the block below. ' +
    'To call one or more of them, end your reply with exactly one block in this format, not wrapped in any other tags, and then stop writing:\n\n' +
    `${TOOL_CALLS_OPEN}\n<call name="TOOL_NAME">{"param": "value"}</call>\n${TOOL_CALLS_CLOSE}\n\n` +
    "Each call body is a single JSON object matching that tool's input_schema. moxxy runs the calls and continues the conversation " +
    'with their results as historical_tool_result entries. Never invent tool results.\n\n' +
    `${definitions.join('\n')}\n</moxxy_tools>`;
}

/** JSON with markup characters escaped as JSON unicode escapes, so it stays valid JSON. */
function jsonForXml(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('&', '\\u0026')
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e');
}

function serializeBlocks(blocks: ReadonlyArray<ContentBlock>): string {
  if (blocks.length === 0) return EMPTY_MESSAGE_PLACEHOLDER;
  return blocks.map(serializeBlock).join('\n');
}

function serializeBlock(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
      return block.text.length > 0 ? escapeXml(block.text) : EMPTY_TEXT_PLACEHOLDER;
    case 'tool_use':
      return '<historical_tool_use status="already_executed_do_not_repeat">\n' +
        `<id>${escapeXml(block.id)}</id>\n` +
        `<name>${escapeXml(block.name)}</name>\n` +
        `<input_json>${escapeXml(stableJson(block.input))}</input_json>\n` +
        '</historical_tool_use>';
    case 'tool_result':
      return `<historical_tool_result tool_use_id="${escapeXml(block.toolUseId)}" status="${block.isError ? 'error' : 'success'}">\n` +
        `${block.content.length > 0 ? escapeXml(block.content) : EMPTY_TEXT_PLACEHOLDER}\n` +
        '</historical_tool_result>';
    case 'reasoning':
      return REASONING_PLACEHOLDER;
    case 'image':
    case 'audio':
      return `[${block.type} attachment omitted: mediaType=${escapeXml(block.mediaType)}; binary data not included]`;
    case 'document': {
      const name = block.name ? `; name=${escapeXml(block.name)}` : '';
      return `[document attachment omitted: mediaType=${escapeXml(block.mediaType)}${name}; binary data not included]`;
    }
    default:
      return assertNever(block);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported content block: ${String(value)}`);
}

function stableJson(value: unknown): string {
  const ancestors = new Set<object>();
  const visit = (candidate: unknown): string => {
    if (candidate === null) return 'null';
    if (typeof candidate === 'string' || typeof candidate === 'boolean') return JSON.stringify(candidate);
    if (typeof candidate === 'number') return Number.isFinite(candidate) ? JSON.stringify(candidate) : JSON.stringify(String(candidate));
    if (typeof candidate === 'bigint') return JSON.stringify(`${candidate.toString()}n`);
    if (typeof candidate === 'undefined') return JSON.stringify('[undefined]');
    if (typeof candidate === 'function' || typeof candidate === 'symbol') return JSON.stringify(`[${typeof candidate} omitted]`);
    if (typeof candidate !== 'object') return JSON.stringify(String(candidate));
    if (ancestors.has(candidate)) return JSON.stringify('[circular reference omitted]');

    ancestors.add(candidate);
    let result: string;
    if (Array.isArray(candidate)) {
      result = `[${candidate.map(visit).join(',')}]`;
    } else {
      const record = candidate as Record<string, unknown>;
      result = `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${visit(record[key])}`).join(',')}}`;
    }
    ancestors.delete(candidate);
    return result;
  };
  return visit(value);
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function createProtocolState(opts: { readonly toolCalls?: boolean } = {}): ProtocolState {
  return {
    started: false,
    ended: false,
    stopReason: 'end_turn',
    ...(opts.toolCalls ? { toolCalls: { held: '' } } : {}),
  };
}

/**
 * Passes text through until a tool-call block opens, then withholds it. A
 * closed block becomes tool_use events plus a terminal `tool_use` message_end.
 * Anything the model writes after the block (typically invented results) is
 * dropped because the caller stops reading at message_end.
 */
function scanText(delta: string, state: ProtocolState): ProviderEvent[] {
  const scan = state.toolCalls;
  if (!scan) return [{ type: 'text_delta', delta }];
  if (scan.block === undefined) {
    const text = scan.held + delta;
    const open = text.indexOf(TOOL_CALLS_OPEN);
    if (open < 0) {
      const keep = partialOpenLength(text);
      scan.held = text.slice(text.length - keep);
      const visible = text.slice(0, text.length - keep);
      return visible ? [{ type: 'text_delta', delta: visible }] : [];
    }
    scan.held = '';
    scan.block = '';
    const before = text.slice(0, open);
    const rest = scanText(text.slice(open + TOOL_CALLS_OPEN.length), state);
    return before ? [{ type: 'text_delta', delta: before }, ...rest] : rest;
  }
  scan.block += delta;
  const close = scan.block.indexOf(TOOL_CALLS_CLOSE);
  if (close < 0) return [];
  const events: ProviderEvent[] = [];
  for (const match of scan.block.slice(0, close).matchAll(TOOL_CALL_PATTERN)) {
    const id = `moxxy_${randomUUID()}`;
    events.push(
      { type: 'tool_use_start', id, name: unescapeXml(match[1] ?? '') },
      { type: 'tool_use_end', id, input: parseCallInput((match[2] ?? '').trim()) },
    );
  }
  if (events.length === 0) {
    // A block without any call is not a request; show it and stop scanning.
    const raw = TOOL_CALLS_OPEN + scan.block;
    state.toolCalls = undefined;
    return [{ type: 'text_delta', delta: raw }];
  }
  state.ended = true;
  return [...events, { type: 'message_end', stopReason: 'tool_use' }];
}

/** A held partial tag or a block that never closed is plain output. */
function flushText(state: ProtocolState): ProviderEvent[] {
  const scan = state.toolCalls;
  if (!scan) return [];
  const rest = scan.block === undefined ? scan.held : TOOL_CALLS_OPEN + scan.block;
  state.toolCalls = { held: '' };
  return rest ? [{ type: 'text_delta', delta: rest }] : [];
}

function partialOpenLength(text: string): number {
  for (let length = Math.min(text.length, TOOL_CALLS_OPEN.length - 1); length > 0; length -= 1) {
    if (TOOL_CALLS_OPEN.startsWith(text.slice(text.length - length))) return length;
  }
  return 0;
}

function parseCallInput(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    // Kept as a string so the dispatcher's schema check reports the problem
    // to the model instead of running the tool with empty input.
    return body;
  }
}

function unescapeXml(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

export function parseClaudeRecord(line: string, state: ProtocolState): ProviderEvent[] {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error('Claude CLI emitted malformed stream-json');
  }
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new Error('Claude CLI emitted malformed stream-json record');
  }

  // Informational envelope records can appear between protocol events on newer
  // Claude CLI versions. They carry no assistant content or terminal state.
  if (value.type === 'system' || value.type === 'rate_limit_event') return [];
  if (value.type === 'assistant' || value.type === 'user') return parseMessageRecord(value);
  if (value.type === 'stream_event') return parseStreamEvent(value.event, state);
  if (value.type === 'result') return parseResult(value, state);
  throw new Error(`Claude CLI emitted unsupported stream-json record: ${value.type}`);
}

function parseMessageRecord(record: Record<string, unknown>): ProviderEvent[] {
  if (!isRecord(record.message) || !Array.isArray(record.message.content)) {
    throw new Error('Claude CLI emitted malformed assistant record');
  }
  for (const block of record.message.content) {
    if (!isRecord(block) || typeof block.type !== 'string') {
      throw new Error('Claude CLI emitted malformed assistant content');
    }
    if (block.type === 'text' && typeof block.text !== 'string') {
      throw new Error('Claude CLI emitted malformed assistant text');
    }
    // Thinking stays private, while tool_use/tool_result are internal CLI
    // bookkeeping that Claude has already executed. Translating any of these
    // records to ProviderEvents would either expose private reasoning or make
    // the moxxy dispatcher execute the same operation a second time.
    if (block.type !== 'text' && block.type !== 'thinking' && block.type !== 'tool_use' && block.type !== 'tool_result') {
      throw new Error('Claude CLI emitted unsupported assistant content');
    }
  }
  // Partial text arrives through stream_event records.
  return [];
}

function parseStreamEvent(raw: unknown, state: ProtocolState): ProviderEvent[] {
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    throw new Error('Claude CLI emitted malformed stream event');
  }
  switch (raw.type) {
    case 'message_start':
      state.started = true;
      return [];
    case 'content_block_start': {
      if (!isRecord(raw.content_block) || typeof raw.content_block.type !== 'string') {
        throw new Error('Claude CLI emitted malformed content block');
      }
      if (raw.content_block.type !== 'text' && raw.content_block.type !== 'thinking' && raw.content_block.type !== 'tool_use' && raw.content_block.type !== 'tool_result') {
        throw new Error('Claude CLI emitted unsupported content block');
      }
      state.blockType = raw.content_block.type;
      return [];
    }
    case 'content_block_delta': {
      if (!isRecord(raw.delta) || typeof raw.delta.type !== 'string') {
        throw new Error('Claude CLI emitted malformed content delta');
      }
      if (state.blockType !== 'text') {
        // input_json_delta and tool result deltas describe work performed by the
        // child and must not escape as moxxy tool events.
        return [];
      }
      if (raw.delta.type !== 'text_delta' || typeof raw.delta.text !== 'string') {
        throw new Error('Claude CLI emitted unsupported text delta');
      }
      return scanText(raw.delta.text, state);
    }
    case 'content_block_stop':
      state.blockType = undefined;
      return [];
    case 'message_stop':
      return [];
    case 'message_delta': {
      if (!isRecord(raw.delta)) throw new Error('Claude CLI emitted malformed message delta');
      // `tool_use` ends an internal CLI round trip (a native tool call, or a
      // rejected attempt at one); the CLI continues with another message.
      if (raw.delta.stop_reason != null && raw.delta.stop_reason !== 'tool_use') {
        state.stopReason = mapStopReason(raw.delta.stop_reason);
      }
      if (isRecord(raw.usage) && typeof raw.usage.output_tokens === 'number') {
        state.outputTokens = raw.usage.output_tokens;
      }
      return [];
    }
    case 'ping':
      return [];
    default:
      throw new Error(`Claude CLI emitted unsupported stream event: ${raw.type}`);
  }
}

function parseResult(record: Record<string, unknown>, state: ProtocolState): ProviderEvent[] {
  if (state.ended) throw new Error('Claude CLI emitted more than one terminal result');
  state.ended = true;
  if (record.is_error === true || record.subtype !== 'success') {
    const message = typeof record.result === 'string' ? record.result : 'Claude CLI request failed';
    return [{ type: 'error', message, retryable: false }];
  }

  if (isRecord(record.usage)) {
    const input = record.usage.input_tokens;
    const output = record.usage.output_tokens;
    if (typeof input === 'number') state.inputTokens = input;
    if (typeof output === 'number') state.outputTokens = output;
  }
  const usage = state.inputTokens !== undefined && state.outputTokens !== undefined
    ? { inputTokens: state.inputTokens, outputTokens: state.outputTokens }
    : undefined;
  return [...flushText(state), { type: 'message_end', stopReason: state.stopReason, ...(usage ? { usage } : {}) }];
}

function mapStopReason(value: unknown): ProtocolState['stopReason'] {
  switch (value) {
    case 'end_turn': return 'end_turn';
    case 'max_tokens': return 'max_tokens';
    case 'stop_sequence': return 'stop_sequence';
    default: throw new Error(`Claude CLI emitted unsupported stop reason: ${String(value)}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
