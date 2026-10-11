import type { AgentGoalStatus, AgentStepEvent, ContentBlock, TokenUsage } from '@moxxy/sdk';
import type { ClaudeContentBlock, ClaudeMessage, ClaudePermissionMode, ClaudeUsage, ClaudeUserContent } from './sdk-types.js';

/** The name Moxxy's MCP server has in Claude; its tools appear as `mcp__moxxy__<name>`. */
export const MOXXY_MCP_SERVER = 'moxxy';
export const MOXXY_TOOL_PREFIX = `mcp__${MOXXY_MCP_SERVER}__`;

/**
 * Claude's messages for one turn, as Moxxy agent events. Calls to Moxxy's own
 * tools are left out: Moxxy records those when it runs them. A subagent's
 * inner work is left out too (it gets its own view later), except the result
 * of a call that was already shown because Claude asked to approve it.
 */
export class TurnTranslator {
  private readonly announced = new Set<string>();
  private readonly moxxyCalls = new Set<string>();

  /** Show a call before Moxxy decides on it, unless it is already shown. */
  announce(callId: string, name: string, input: unknown): AgentStepEvent[] {
    if (this.announced.has(callId) || name.startsWith(MOXXY_TOOL_PREFIX)) return [];
    this.announced.add(callId);
    return [{ type: 'tool_call', callId, name, input }];
  }

  translate(message: ClaudeMessage): AgentStepEvent[] {
    switch (message.type) {
      case 'system':
        return 'session_id' in message && isInit(message) ? this.fromInit(message) : [];
      case 'stream_event':
        return isMainThread(message) ? fromDelta(message) : [];
      case 'assistant':
        return isMainThread(message) ? this.fromAssistant(message) : [];
      case 'user':
        return this.fromToolResults(message);
      default:
        return [];
    }
  }

  private fromInit(message: { session_id: string; permissionMode?: ClaudePermissionMode }): AgentStepEvent[] {
    const events: AgentStepEvent[] = [{ type: 'session', sessionId: message.session_id }];
    const enabled = message.permissionMode ? autoApproveFor(message.permissionMode) : undefined;
    if (enabled !== undefined) events.push({ type: 'auto_approve', enabled });
    return events;
  }

  private fromAssistant(message: { message: { content: ReadonlyArray<ClaudeContentBlock> } }): AgentStepEvent[] {
    const events: AgentStepEvent[] = [];
    const blocks = message.message.content;
    const thinking = blocks.flatMap((b) => (isThinking(b) && b.thinking ? [b.thinking] : [])).join('\n');
    if (thinking) events.push({ type: 'reasoning', text: thinking });
    const text = blocks.flatMap((b) => (isText(b) ? [b.text] : [])).join('');
    const calls = blocks.filter(isToolUse);
    if (text) events.push({ type: 'message', text, stopReason: calls.length > 0 ? 'tool_use' : 'end_turn' });
    for (const call of calls) {
      if (call.name.startsWith(MOXXY_TOOL_PREFIX)) this.moxxyCalls.add(call.id);
      else events.push(...this.announce(call.id, call.name, call.input));
    }
    return events;
  }

  private fromToolResults(message: { message: { content: string | ReadonlyArray<ClaudeContentBlock> } }): AgentStepEvent[] {
    const { content } = message.message;
    if (typeof content === 'string') return [];
    const events: AgentStepEvent[] = [];
    for (const block of content) {
      if (!isToolResult(block) || this.moxxyCalls.has(block.tool_use_id) || !this.announced.has(block.tool_use_id)) continue;
      const text = resultText(block.content);
      events.push(
        block.is_error
          ? { type: 'tool_result', callId: block.tool_use_id, ok: false, error: text }
          : { type: 'tool_result', callId: block.tool_use_id, ok: true, output: text },
      );
    }
    return events;
  }
}

/** Claude's permission mode as the conversation's auto-approve; `undefined` when the mode says nothing about it. */
export function autoApproveFor(mode: ClaudePermissionMode): boolean | undefined {
  switch (mode) {
    case 'bypassPermissions':
      return true;
    case 'default':
    case 'acceptEdits':
    case 'dontAsk':
      return false;
    default:
      return undefined;
  }
}

/** What `/goal` without arguments answers, as the state of the goal. */
export function goalStatusFrom(text: string): AgentGoalStatus | undefined {
  if (/^Goal active\b/.test(text)) return 'active';
  if (/^No goal set\b/.test(text)) return 'complete';
  return undefined;
}

export function toTokenUsage(usage: ClaudeUsage): TokenUsage {
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    ...(usage.cache_read_input_tokens ? { cacheReadTokens: usage.cache_read_input_tokens } : {}),
    ...(usage.cache_creation_input_tokens ? { cacheCreationTokens: usage.cache_creation_input_tokens } : {}),
  };
}

/** The person's message as Messages API blocks; `prefix` goes in front of the first text (`/goal `). */
export function toClaudeContent(prompt: ReadonlyArray<ContentBlock>, prefix = ''): ClaudeUserContent {
  let pending = prefix;
  const blocks: Exclude<ClaudeUserContent, string>[number][] = [];
  for (const block of prompt) {
    if (block.type === 'text') {
      blocks.push({ type: 'text', text: `${pending}${block.text}` });
      pending = '';
    } else if (block.type === 'image' || block.type === 'document') {
      blocks.push({ type: block.type, source: { type: 'base64', media_type: block.mediaType, data: block.data } });
    }
  }
  if (pending) blocks.unshift({ type: 'text', text: pending.trimEnd() });
  return blocks;
}

function fromDelta(message: { event: { type: string; delta?: { type: string; text?: string; thinking?: string } } }): AgentStepEvent[] {
  const { event } = message;
  if (event.type !== 'content_block_delta' || !event.delta) return [];
  if (event.delta.type === 'text_delta' && event.delta.text) return [{ type: 'text_delta', delta: event.delta.text }];
  if (event.delta.type === 'thinking_delta' && event.delta.thinking) return [{ type: 'reasoning_delta', delta: event.delta.thinking }];
  return [];
}

function resultText(content: string | ReadonlyArray<{ type: string; text?: string }> | undefined): string {
  if (typeof content === 'string') return content;
  if (!content) return '';
  return content.flatMap((part) => (part.type === 'text' && part.text ? [part.text] : [])).join('\n');
}

function isInit(message: { subtype?: string }): message is { subtype: 'init'; session_id: string; permissionMode?: ClaudePermissionMode } {
  return message.subtype === 'init';
}

function isMainThread(message: { parent_tool_use_id?: string | null }): boolean {
  return message.parent_tool_use_id === null || message.parent_tool_use_id === undefined;
}

function isText(block: ClaudeContentBlock): block is { type: 'text'; text: string } {
  return block.type === 'text';
}

function isThinking(block: ClaudeContentBlock): block is { type: 'thinking'; thinking: string } {
  return block.type === 'thinking';
}

function isToolUse(block: ClaudeContentBlock): block is { type: 'tool_use'; id: string; name: string; input: unknown } {
  return block.type === 'tool_use';
}

function isToolResult(block: ClaudeContentBlock): block is {
  type: 'tool_result';
  tool_use_id: string;
  content?: string | ReadonlyArray<{ type: string; text?: string }>;
  is_error?: boolean;
} {
  return block.type === 'tool_result';
}
