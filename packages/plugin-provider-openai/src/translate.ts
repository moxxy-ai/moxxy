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

export function toOpenAIMessages(messages: ReadonlyArray<ProviderMessage>): OpenAIChatMessage[] {
  const out: OpenAIChatMessage[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      const text = msg.content.find((c): c is { type: 'text'; text: string } => c.type === 'text')?.text ?? '';
      if (text) out.push({ role: 'system', content: text });
      continue;
    }
    if (msg.role === 'user') {
      const hasRichPart = msg.content.some((c) => c.type === 'image' || c.type === 'document');
      if (hasRichPart) {
        // Vision/document user message: emit content as a parts array so
        // base64 images and documents (PDFs) ride alongside text. Non-vision
        // / non-document OpenAI models will 400 on this shape — callers gate
        // by `supportsImages` / `supportsDocuments` on the model descriptor
        // before attaching.
        const parts: OpenAIUserContentPart[] = [];
        for (const c of msg.content) {
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
        out.push({ role: 'user', content: parts });
      } else {
        const text = msg.content
          .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
          .map((c) => c.text)
          .join('\n');
        out.push({ role: 'user', content: text });
      }
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
    }
  }
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

