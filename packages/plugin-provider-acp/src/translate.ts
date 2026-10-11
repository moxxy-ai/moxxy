import type { AgentStepEvent, ContentBlock, FileDiffDisplay, TokenUsage } from '@moxxy/sdk';
import { diffPathIn, fileDiffFromPatch, fileDiffFromText, parseUnifiedDiff } from '@moxxy/sdk';
import type { AcpContentBlock, AcpSessionUpdate, AcpToolCall, AcpToolKind, AcpUsage } from './protocol.js';

/** A tool the agent runs itself, as Moxxy names it (`Bash`, `Read`, … so Moxxy's rules and formatting apply). */
export interface AcpShownCall {
  readonly name: string;
  readonly input: unknown;
}

interface CallState {
  /** The agent's own tool name, from the first `tool_call` (`bash`, `read`, `moxxy_browser_open`). */
  readonly tool: string;
  kind: AcpToolKind | undefined;
  input: Record<string, unknown>;
  shown: AcpShownCall | undefined;
  ended: boolean;
}

/**
 * One agent prompt's `session/update` notifications as Moxxy agent events.
 * ACP announces a tool before its input is known (a `pending` `tool_call`
 * with no or partial `rawInput`, OpenCode's command with its folder only, then
 * an `in_progress` update with the input), so a call is shown once it starts. Calls to Moxxy's own tools (`moxxy_*` for OpenCode) are left
 * out: Moxxy records those when it runs them.
 */
export class AcpTurnTranslator {
  private readonly calls = new Map<string, CallState>();
  private text = '';
  private thought = '';

  /** `cwd`: the project folder, which the paths of file diffs are shown relative to. */
  constructor(
    private readonly moxxyToolPrefix: string,
    private readonly cwd = '',
  ) {}

  update(update: AcpSessionUpdate): AgentStepEvent[] {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        const chunk = textOf(update.content);
        if (!chunk) return [];
        const events = this.flushThought();
        this.text += chunk;
        events.push({ type: 'text_delta', delta: chunk });
        return events;
      }
      case 'agent_thought_chunk': {
        const chunk = textOf(update.content);
        if (!chunk) return [];
        this.thought += chunk;
        return [{ type: 'reasoning_delta', delta: chunk }];
      }
      case 'tool_call':
        return this.toolCall(update as AcpToolCall, true);
      case 'tool_call_update':
        return this.toolCall(update as AcpToolCall, false);
      default:
        return [];
    }
  }

  /** The prompt ended: what the agent said last is its final message. */
  finish(): AgentStepEvent[] {
    return [...this.flushThought(), ...this.flushText('end_turn')];
  }

  /** The call a permission ask is about, shown first if it is not yet. */
  callFor(toolCall: AcpToolCall): { readonly call: AcpShownCall; readonly events: AgentStepEvent[] } {
    const state = this.calls.get(toolCall.toolCallId);
    if (state?.shown) return { call: state.shown, events: [] };
    const tool = state?.tool ?? toolCall.title ?? 'tool';
    const fresh: CallState = state ?? { tool, kind: toolCall.kind, input: {}, shown: undefined, ended: false };
    fresh.input = { ...fresh.input, ...asRecord(toolCall.rawInput) };
    this.calls.set(toolCall.toolCallId, fresh);
    const events = [...this.flushThought(), ...this.flushText('tool_use'), ...this.show(toolCall.toolCallId, fresh)];
    return { call: fresh.shown ?? shownCall(tool, fresh.kind, fresh.input), events };
  }

  /** Close the calls still open (the prompt ended without their result). */
  openCalls(): string[] {
    return [...this.calls.entries()].flatMap(([id, state]) => (state.shown && !state.ended ? [id] : []));
  }

  private toolCall(update: AcpToolCall, first: boolean): AgentStepEvent[] {
    let state = this.calls.get(update.toolCallId);
    if (!state) {
      if (!first && update.title === undefined) return [];
      state = { tool: update.title ?? 'tool', kind: update.kind, input: {}, shown: undefined, ended: false };
      this.calls.set(update.toolCallId, state);
    }
    if (this.isMoxxyTool(state.tool)) return [];
    if (update.kind) state.kind = update.kind;
    const raw = asRecord(update.rawInput);
    if (Object.keys(raw).length > 0) state.input = { ...state.input, ...raw };

    const events: AgentStepEvent[] = [];
    const done = update.status === 'completed' || update.status === 'failed';
    const started = update.status === 'in_progress' || done || (!first && update.status === undefined && Object.keys(raw).length > 0);
    if (!state.shown && started) {
      events.push(...this.flushThought(), ...this.flushText('tool_use'), ...this.show(update.toolCallId, state));
    }
    if (done && state.shown && !state.ended) {
      state.ended = true;
      const output = toolOutput(update);
      const diff = update.status === 'completed' ? fileDiffOf(state.tool, state.input, update.rawOutput, this.cwd) : undefined;
      events.push(
        update.status === 'completed'
          ? { type: 'tool_result', callId: update.toolCallId, ok: true, output: diff ? { forModel: output, display: diff } : output }
          : { type: 'tool_result', callId: update.toolCallId, ok: false, error: output || 'the tool failed' },
      );
    }
    return events;
  }

  private show(callId: string, state: CallState): AgentStepEvent[] {
    if (state.shown || this.isMoxxyTool(state.tool)) return [];
    state.shown = shownCall(state.tool, state.kind, state.input);
    return [{ type: 'tool_call', callId, name: state.shown.name, input: state.shown.input }];
  }

  private isMoxxyTool(tool: string): boolean {
    return tool.startsWith(this.moxxyToolPrefix);
  }

  private flushText(stopReason: 'tool_use' | 'end_turn'): AgentStepEvent[] {
    const text = this.text.trim();
    this.text = '';
    return text ? [{ type: 'message', text, stopReason }] : [];
  }

  private flushThought(): AgentStepEvent[] {
    const text = this.thought.trim();
    this.thought = '';
    return text ? [{ type: 'reasoning', text }] : [];
  }
}

/** The agent's tool under the name Moxxy knows it by, with Moxxy's input keys. */
export function shownCall(tool: string, kind: AcpToolKind | undefined, input: Record<string, unknown>): AcpShownCall {
  const pick = (pairs: ReadonlyArray<readonly [string, string]>): Record<string, unknown> =>
    Object.fromEntries(pairs.flatMap(([from, to]) => (input[from] === undefined ? [] : [[to, input[from]]])));
  switch (tool) {
    case 'bash':
      return { name: 'Bash', input: pick([['command', 'command'], ['description', 'description'], ['timeout', 'timeout']]) };
    case 'read':
      return { name: 'Read', input: pick([['filePath', 'file_path'], ['offset', 'offset'], ['limit', 'limit']]) };
    // An ask about a change names the file as `filepath` and carries its diff.
    case 'write':
      return { name: 'Write', input: pick([['filePath', 'file_path'], ['filepath', 'file_path'], ['content', 'content'], ['diff', 'diff']]) };
    case 'edit':
      return {
        name: 'Edit',
        input: pick([['filePath', 'file_path'], ['filepath', 'file_path'], ['oldString', 'old_string'], ['newString', 'new_string'], ['replaceAll', 'replace_all'], ['diff', 'diff']]),
      };
    case 'glob':
      return { name: 'Glob', input: pick([['pattern', 'pattern'], ['path', 'path']]) };
    case 'grep':
      return { name: 'Grep', input: pick([['pattern', 'pattern'], ['path', 'path'], ['include', 'glob']]) };
    case 'webfetch':
      return { name: 'web_fetch', input: input };
    case 'websearch':
      return { name: 'web_search', input: input };
    case 'todowrite':
      return { name: 'TodoWrite', input: input };
    case 'task':
      return { name: 'Task', input: input };
    case 'skill':
      return { name: 'Skill', input: input };
    case 'apply_patch':
    case 'patch':
      return { name: 'apply_patch', input: input };
    default:
      return { name: kind === 'execute' ? 'Bash' : tool, input: input };
  }
}

/**
 * An OpenCode edit or new file as a diff. An edit's metadata has the unified
 * diff (its `content` has only the replaced text, without line numbers); a
 * write gives the content, and says whether the file `exists`ed before.
 */
function fileDiffOf(tool: string, input: Record<string, unknown>, rawOutput: unknown, cwd: string): FileDiffDisplay | undefined {
  const metadata = asRecord(asRecord(rawOutput).metadata);
  const file = typeof input.filePath === 'string' ? input.filePath : undefined;
  if (!file) return undefined;
  const path = diffPathIn(cwd, file);
  if (tool === 'edit' && typeof metadata.diff === 'string') {
    const hunks = parseUnifiedDiff(metadata.diff);
    return hunks.length > 0 ? fileDiffFromPatch({ path, mode: 'update', hunks }) : undefined;
  }
  if (tool === 'write' && metadata.exists === false && typeof input.content === 'string') {
    return fileDiffFromText({ path, mode: 'create', before: '', after: input.content });
  }
  return undefined;
}

function toolOutput(update: AcpToolCall): string {
  const texts = (update.content ?? []).flatMap((part) => {
    if (part.type === 'content' && part.content.type === 'text' && typeof part.content.text === 'string') return [part.content.text];
    if (part.type === 'diff') return [`${part.path}\n${part.newText}`];
    return [];
  });
  return texts.join('\n');
}

function textOf(content: unknown): string {
  const block = content as { type?: unknown; text?: unknown } | undefined;
  return block && block.type === 'text' && typeof block.text === 'string' ? block.text : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function toTokenUsage(usage: AcpUsage): TokenUsage {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: (usage.outputTokens ?? 0) + (usage.thoughtTokens ?? 0),
    ...(usage.cachedReadTokens ? { cacheReadTokens: usage.cachedReadTokens } : {}),
    ...(usage.cachedWriteTokens ? { cacheCreationTokens: usage.cachedWriteTokens } : {}),
  };
}

/** The person's message as ACP content: text, images, and documents as embedded resources. */
export function toAcpPrompt(prompt: ReadonlyArray<ContentBlock>): AcpContentBlock[] {
  return prompt.flatMap((block): AcpContentBlock[] => {
    if (block.type === 'text') return block.text ? [{ type: 'text', text: block.text }] : [];
    if (block.type === 'image') return [{ type: 'image', mimeType: block.mediaType, data: block.data }];
    if (block.type === 'document') {
      const name = block.name ?? 'document';
      return [{ type: 'resource', resource: { uri: `attachment:///${encodeURIComponent(name)}`, mimeType: block.mediaType, blob: block.data } }];
    }
    return [];
  });
}

export function promptText(prompt: ReadonlyArray<ContentBlock>): string {
  return prompt.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
}
