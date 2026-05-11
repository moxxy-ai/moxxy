import type { ContentBlock, ProviderMessage, ToolDef } from '@moxxy/sdk';

export interface AnthropicMessageInput {
  role: 'user' | 'assistant';
  content: Array<AnthropicContentBlock>;
}

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: unknown;
}

export function toAnthropicMessages(messages: ReadonlyArray<ProviderMessage>): {
  system: string | undefined;
  messages: AnthropicMessageInput[];
} {
  let system: string | undefined;
  const out: AnthropicMessageInput[] = [];
  let pendingUserBlocks: AnthropicContentBlock[] | null = null;
  const flushUser = (): void => {
    if (pendingUserBlocks) {
      out.push({ role: 'user', content: pendingUserBlocks });
      pendingUserBlocks = null;
    }
  };

  for (const msg of messages) {
    if (msg.role === 'system') {
      const textBlock = msg.content.find((c) => c.type === 'text');
      if (textBlock && textBlock.type === 'text') {
        system = system ? `${system}\n\n${textBlock.text}` : textBlock.text;
      }
      continue;
    }

    if (msg.role === 'user') {
      flushUser();
      out.push({ role: 'user', content: msg.content.map(toAnthropicBlock) });
      continue;
    }

    if (msg.role === 'assistant') {
      flushUser();
      out.push({ role: 'assistant', content: msg.content.map(toAnthropicBlock) });
      continue;
    }

    if (msg.role === 'tool_result') {
      // Tool results are merged into a user message with tool_result content blocks
      pendingUserBlocks ??= [];
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          pendingUserBlocks.push({
            type: 'tool_result',
            tool_use_id: block.toolUseId,
            content: block.content,
            is_error: block.isError,
          });
        }
      }
    }
  }
  flushUser();
  return { system, messages: out };
}

function toAnthropicBlock(block: ContentBlock): AnthropicContentBlock {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: block.toolUseId,
        content: block.content,
        is_error: block.isError,
      };
    case 'image':
      return {
        type: 'image',
        source: { type: 'base64', media_type: block.mediaType, data: block.data },
      };
  }
}

export function toAnthropicTools(tools: ReadonlyArray<ToolDef>): AnthropicToolDef[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputJsonSchema ?? zodToJsonSchema(t.inputSchema),
  }));
}

// Minimal zod->json-schema conversion. For richer schemas users can add zod-to-json-schema.
function zodToJsonSchema(schema: unknown): unknown {
  const s = schema as { _def?: { typeName?: string }; toJSON?: () => unknown };
  if (typeof s.toJSON === 'function') return s.toJSON();
  // Fallback: best-effort shape based on zod's _def
  const def = s._def;
  const typeName = def?.typeName;
  if (typeName === 'ZodObject') {
    const shape = (def as unknown as { shape: () => Record<string, unknown> }).shape();
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      const inner = (value as { isOptional?: () => boolean }).isOptional?.();
      if (!inner) required.push(key);
    }
    return { type: 'object', properties, required };
  }
  if (typeName === 'ZodString') return { type: 'string' };
  if (typeName === 'ZodNumber') return { type: 'number' };
  if (typeName === 'ZodBoolean') return { type: 'boolean' };
  if (typeName === 'ZodArray') {
    const items = zodToJsonSchema((def as unknown as { type: unknown }).type);
    return { type: 'array', items };
  }
  return {};
}
