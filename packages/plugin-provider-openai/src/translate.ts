import type { ProviderMessage, ToolDef } from '@moxxy/sdk';
import { zodToJsonSchema } from '@moxxy/sdk';

export type OpenAIUserContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename?: string; file_data: string } };

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | ReadonlyArray<OpenAIUserContentPart> | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

export interface OpenAIToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
}

/**
 * Serialize a tool-call `input` to the JSON string OpenAI expects in
 * `function.arguments`. A circular or otherwise non-serializable object (a
 * hostile/corrupt in-memory replay) would make a bare `JSON.stringify` throw
 * and crash translation of the WHOLE request. Degrade that one argument to
 * `{}` instead of taking down the turn.
 */
function safeStringifyArgs(input: unknown): string {
  try {
    return JSON.stringify(input ?? {}) ?? '{}';
  } catch {
    return '{}';
  }
}

function toUserMessage(content: ProviderMessage['content']): OpenAIChatMessage {
  const hasRichPart = content.some((c) => c.type === 'image' || c.type === 'document');
  if (!hasRichPart) {
    const text = content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    return { role: 'user', content: text };
  }
  // Keep the existing rich user format for both user and tool attachments.
  const parts: OpenAIUserContentPart[] = [];
  for (const c of content) {
    if (c.type === 'text') {
      parts.push({ type: 'text', text: c.text });
    } else if (c.type === 'image') {
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${c.mediaType};base64,${c.data}` },
      });
    } else if (c.type === 'document') {
      parts.push({
        type: 'file',
        file: {
          ...(c.name ? { filename: c.name } : {}),
          file_data: `data:${c.mediaType};base64,${c.data}`,
        },
      });
    }
  }
  return { role: 'user', content: parts };
}

export function toOpenAIMessages(messages: ReadonlyArray<ProviderMessage>): OpenAIChatMessage[] {
  const out: OpenAIChatMessage[] = [];
  const attachments: OpenAIChatMessage[] = [];
  for (const msg of messages) {
    // Chat Completions requires all parallel tool replies before the next
    // user message. Defer pixels until the contiguous result batch is complete.
    if (msg.role !== 'tool_result') out.push(...attachments.splice(0));
    if (msg.role === 'system') {
      const text = msg.content.find((c): c is { type: 'text'; text: string } => c.type === 'text')?.text ?? '';
      if (text) out.push({ role: 'system', content: text });
      continue;
    }
    if (msg.role === 'user') {
      out.push(toUserMessage(msg.content));
      continue;
    }
    if (msg.role === 'assistant') {
      const text = msg.content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map((c) => c.text)
        .join('');
      const toolUses = msg.content.filter(
        (c): c is { type: 'tool_use'; id: string; name: string; input: unknown } =>
          c.type === 'tool_use',
      );
      const hasToolUses = toolUses.length > 0;
      // OpenAI accepts `content: null` on an assistant turn ONLY when it carries
      // `tool_calls`. An assistant message that projected to neither text nor a
      // tool call (e.g. a turn whose only block is a reasoning block, which we
      // don't replay to OpenAI) would otherwise emit `{ content: null }` with no
      // tool_calls — a hard 400. Degrade to an empty-string content so the turn
      // is well-formed instead of crashing the whole request.
      const message: OpenAIChatMessage = {
        role: 'assistant',
        content: text || (hasToolUses ? null : ''),
      };
      if (hasToolUses) {
        message.tool_calls = toolUses.map((u) => ({
          id: u.id,
          type: 'function' as const,
          function: { name: u.name, arguments: safeStringifyArgs(u.input) },
        }));
      }
      out.push(message);
      continue;
    }
    if (msg.role === 'tool_result') {
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          out.push({
            role: 'tool',
            tool_call_id: block.toolUseId,
            content: block.content,
          });
        }
      }
      const content = msg.content.filter((block) => block.type === 'text' || block.type === 'image' || block.type === 'document');
      if (content.length > 0) attachments.push(toUserMessage(content));
    }
  }
  out.push(...attachments);
  return out;
}

export function toOpenAITools(tools: ReadonlyArray<ToolDef>): OpenAIToolDef[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: (t.inputJsonSchema ?? zodToJsonSchema(t.inputSchema)) as unknown,
    },
  }));
}
