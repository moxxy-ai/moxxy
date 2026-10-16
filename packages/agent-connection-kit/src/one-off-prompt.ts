import type { ProviderMessage, ProviderRequest } from '@moxxy/sdk';

/** A one-off request for an agent: its instructions apart, so the agent never reads them as words the person said. */
export interface OneOffPrompt {
  /** The `role: 'system'` messages, then `req.system`; absent when there are none. */
  readonly system?: string;
  readonly prompt: string;
}

/** A one-off request (a summary, a skill draft, a research plan) as one prompt: a single message as it is, several as a labelled transcript. */
export function oneOffPrompt(req: Pick<ProviderRequest, 'system' | 'messages'>): OneOffPrompt {
  const instructions = req.messages.filter((message) => message.role === 'system').map(textOf);
  const system = [...instructions, req.system ?? ''].filter(Boolean).join('\n\n');
  const said = req.messages.filter((message) => message.role !== 'system');
  const [only] = said;
  const prompt =
    said.length === 1 && only
      ? textOf(only)
      : said.map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${textOf(message)}`).join('\n\n');
  return system ? { system, prompt } : { prompt };
}

function textOf(message: ProviderMessage): string {
  return message.content.flatMap((block) => (block.type === 'text' ? [block.text] : block.type === 'tool_result' ? [block.content] : [])).join('\n');
}
