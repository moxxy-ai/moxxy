/**
 * The models the person's Codex offers their account, as its own picker lists
 * them: a short-lived `codex app-server` answers `model/list`, page by page,
 * and is closed. Codex caches the list for a few minutes; the hourly check
 * picks up a change after that.
 */
import type { ModelDescriptor } from '@moxxy/sdk';
import { JsonRpcLineClient } from '@moxxy/agent-connection-kit';
import { codexAgentModels } from './agent-provider.js';
import type { StartCodexAppServer } from './codex-session.js';
import type { CodexModelList } from './protocol.js';

/** Codex answers in well under a second; one stuck on startup is not waited on longer. */
const OFFERED_MODELS_TIMEOUT_MS = 15_000;
/** `model/list` says nothing of the window; a model Moxxy does not know gets this one. */
const UNKNOWN_MODEL: Omit<ModelDescriptor, 'id'> = {
  contextWindow: 400_000,
  maxOutputTokens: 128_000,
  supportsTools: true,
  supportsStreaming: true,
  supportsImages: true,
  supportsDocuments: false,
  supportsAudio: false,
  supportsReasoning: true,
  hostedTools: ['web_search'],
};

export async function codexOfferedModels(
  cwd: string,
  start: StartCodexAppServer,
  opts: { readonly timeoutMs?: number } = {},
): Promise<ReadonlyArray<ModelDescriptor>> {
  let connection: Awaited<ReturnType<StartCodexAppServer>> | undefined;
  let client: JsonRpcLineClient | undefined;
  const timer = setTimeout(() => client?.close(new Error('Codex did not answer in time.')), opts.timeoutMs ?? OFFERED_MODELS_TIMEOUT_MS);
  try {
    connection = await start({ cwd });
    client = new JsonRpcLineClient({ readable: connection.readable, writable: connection.writable });
    await client.request('initialize', { clientInfo: { name: 'moxxy', title: 'Moxxy', version: '1' }, capabilities: { experimentalApi: true } });
    client.notify('initialized');
    const models: ModelDescriptor[] = [];
    let cursor: string | null | undefined;
    do {
      const page: CodexModelList = await client.request<CodexModelList>('model/list', cursor ? { cursor } : {});
      for (const model of page.data) if (!model.hidden) models.push(describe(model));
      cursor = page.nextCursor;
    } while (cursor);
    return models;
  } finally {
    clearTimeout(timer);
    client?.close();
    connection?.close();
  }
}

function describe(model: CodexModelList['data'][number]): ModelDescriptor {
  const known = codexAgentModels.find((descriptor) => descriptor.id === model.id) ?? UNKNOWN_MODEL;
  return {
    ...known,
    id: model.id,
    supportsImages: model.inputModalities?.includes('image') ?? known.supportsImages ?? false,
    supportsReasoning: (model.supportedReasoningEfforts?.length ?? 0) > 0,
    supportsFast: model.additionalSpeedTiers?.includes('fast') ?? false,
  };
}
