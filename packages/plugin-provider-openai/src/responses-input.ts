import type OpenAI from 'openai';
import type { ProviderMessage, ToolDef } from '@moxxy/sdk';
import { zodToJsonSchema } from '@moxxy/sdk';
import { toOpenAIMessages, type OpenAIChatMessage } from './translate.js';

/** Reuse the compatibility adapter's argument and attachment conversion. */
export function toResponsesInput(messages: ReadonlyArray<ProviderMessage>, provider: string): OpenAI.Responses.ResponseInput {
  const input: OpenAI.Responses.ResponseInput = [];
  for (const source of messages) {
    for (const block of source.content) {
      if (block.type !== 'reasoning') continue;
      for (const replay of block.replayItems ?? []) {
        if (replay.provider === provider && replay.item.type === 'reasoning') {
          input.push(replay.item as unknown as OpenAI.Responses.ResponseReasoningItem);
        }
      }
    }
    input.push(...toOpenAIMessages([source]).flatMap(toResponseItems));
  }
  return input;
}

function toResponseItems(message: OpenAIChatMessage): OpenAI.Responses.ResponseInput {
  if (message.role === 'tool') {
    return [{ type: 'function_call_output', call_id: message.tool_call_id ?? '', output: typeof message.content === 'string' ? message.content : '' }];
  }
  if (message.role === 'assistant') {
    const items: OpenAI.Responses.ResponseInput = [];
    if (typeof message.content === 'string' && message.content) items.push({ role: 'assistant', content: message.content });
    for (const call of message.tool_calls ?? []) {
      items.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments });
    }
    return items;
  }
  if (typeof message.content === 'string') {
    return [{ role: message.role, content: [{ type: 'input_text', text: message.content }] }];
  }
  const content: OpenAI.Responses.ResponseInputContent[] = (message.content ?? []).map((part) => {
    if (part.type === 'text') return { type: 'input_text', text: part.text };
    if (part.type === 'image_url') return { type: 'input_image', image_url: part.image_url.url, detail: 'auto' };
    return { type: 'input_file', file_data: part.file.file_data, filename: part.file.filename ?? 'document.pdf' };
  });
  return [{ role: message.role, content }];
}

export function toResponsesTools(tools: ReadonlyArray<ToolDef>): OpenAI.Responses.FunctionTool[] {
  return tools.map((tool) => ({
    type: 'function', name: tool.name, description: tool.description,
    parameters: (tool.inputJsonSchema ?? zodToJsonSchema(tool.inputSchema)) as Record<string, unknown>,
    // Responses otherwise enables strict mode implicitly; existing Moxxy
    // schemas support optional fields and are validated by the dispatcher.
    strict: false,
  }));
}
