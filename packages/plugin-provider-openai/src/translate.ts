import type { ProviderMessage, ToolDef } from '@moxxy/sdk';
import { zodToJsonSchema } from '@moxxy/sdk';

export type OpenAIUserContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

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

export function toOpenAIMessages(messages: ReadonlyArray<ProviderMessage>): OpenAIChatMessage[] {
  const out: OpenAIChatMessage[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      const text = msg.content.find((c): c is { type: 'text'; text: string } => c.type === 'text')?.text ?? '';
      if (text) out.push({ role: 'system', content: text });
      continue;
    }
    if (msg.role === 'user') {
      const hasImage = msg.content.some((c) => c.type === 'image');
      if (hasImage) {
        // Vision-capable user message: emit content as a parts array so
        // base64 images ride alongside text. Non-vision OpenAI models
        // will 400 on this shape — callers gate by `supportsImages` on
        // the model descriptor before attaching images.
        const parts: OpenAIUserContentPart[] = [];
        for (const c of msg.content) {
          if (c.type === 'text') {
            parts.push({ type: 'text', text: c.text });
          } else if (c.type === 'image') {
            parts.push({
              type: 'image_url',
              image_url: { url: `data:${c.mediaType};base64,${c.data}` },
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
      const message: OpenAIChatMessage = { role: 'assistant', content: text || null };
      if (toolUses.length > 0) {
        message.tool_calls = toolUses.map((u) => ({
          id: u.id,
          type: 'function' as const,
          function: { name: u.name, arguments: JSON.stringify(u.input ?? {}) },
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

