/**
 * The models the person's Claude offers their account, as its own picker lists
 * them. An Agent SDK `query()` that is sent no message answers
 * `supportedModels()` and is closed, so no turn runs and no usage is spent.
 */
import type { ModelDescriptor } from '@moxxy/sdk';
import { claudeCodeModels } from './agent-provider.js';
import type { ClaudeAgentSdk, ClaudeUserMessage } from './sdk-types.js';

/** `supportedModels` says nothing of the window; a model Moxxy does not know gets this one. */
const UNKNOWN_MODEL: Omit<ModelDescriptor, 'id'> = {
  contextWindow: 400_000,
  maxOutputTokens: 128_000,
  supportsTools: true,
  supportsStreaming: true,
  supportsImages: true,
  supportsDocuments: true,
  supportsAudio: false,
  supportsReasoning: true,
  hostedTools: ['web_search'],
};

export async function claudeOfferedModels(opts: {
  readonly sdk: ClaudeAgentSdk;
  readonly cwd: string;
  readonly executable?: string;
}): Promise<ReadonlyArray<ModelDescriptor>> {
  const query = opts.sdk.query({
    prompt: noMessages(),
    options: {
      cwd: opts.cwd,
      systemPrompt: '',
      ...(opts.executable ? { pathToClaudeCodeExecutable: opts.executable } : {}),
    },
  });
  try {
    const models: ModelDescriptor[] = [];
    for (const info of await query.supportedModels()) {
      const id = info.resolvedModel ?? info.value;
      if (info.value === 'default' || models.some((model) => model.id === id)) continue;
      models.push(describe(id));
    }
    return models;
  } finally {
    query.close();
  }
}

// No `supportsFast`, even where Claude reports `supportsFastMode`: Moxxy does
// not drive Claude's fast mode (it bills usage credits on its own), so the
// picker offers no Fast switch for Claude Code.
function describe(id: string): ModelDescriptor {
  const known = claudeCodeModels.find((model) => model.id === id);
  return { ...(known ?? UNKNOWN_MODEL), id };
}

/** A prompt that never sends: the query stays open only to answer the model list. */
async function* noMessages(): AsyncIterable<ClaudeUserMessage> {
  await new Promise<never>(() => undefined);
}
