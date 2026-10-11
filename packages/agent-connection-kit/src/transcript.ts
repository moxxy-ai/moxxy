import type { ProviderMessage } from '@moxxy/sdk';

/** A one-off request (a summary, a skill draft) as one prompt: a single message as it is, several as a labelled transcript. */
export function transcript(messages: ReadonlyArray<ProviderMessage>): string {
  const textOf = (message: ProviderMessage) =>
    message.content.flatMap((block) => (block.type === 'text' ? [block.text] : block.type === 'tool_result' ? [block.content] : [])).join('\n');
  const [only] = messages;
  if (messages.length === 1 && only) return textOf(only);
  return messages.map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${textOf(message)}`).join('\n\n');
}
