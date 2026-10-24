import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ModelDescriptor, ToolContext } from '@moxxy/sdk';
import { FakeProvider, textReply } from '@moxxy/testing';
import { removeDir } from '@moxxy/vitest-preset/fs';
import { WorkflowStore } from './store.js';
import { buildWorkflowTools, type WorkflowToolDeps } from './tools.js';

const model = (id: string): ModelDescriptor => ({ id, contextWindow: 200_000, maxOutputTokens: 8000, supportsTools: true, supportsStreaming: true });

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moxxy-wf-tools-'));
});
afterEach(async () => {
  await removeDir(dir);
});

/** Drafts with `provider`; the reply is no workflow, so the tool stops before it writes. */
async function draftOn(provider: FakeProvider, extra: Partial<WorkflowToolDeps> = {}): Promise<void> {
  const tools = buildWorkflowTools({
    store: new WorkflowStore({ cwd: dir, userDir: path.join(dir, 'user') }),
    skills: { byName: () => undefined },
    tools: { get: () => undefined, execute: async () => undefined },
    getActiveExecutor: () => null,
    runRecordDir: null,
    provider: () => provider,
    ...extra,
  });
  const create = tools.find((tool) => tool.name === 'workflow_create');
  if (!create) throw new Error('workflow_create is missing');
  const ctx = { signal: new AbortController().signal } as unknown as ToolContext;
  await expect(create.handler({ intent: 'Say hello every morning', scope: 'user' }, ctx)).rejects.toThrow();
}

describe('workflow_create', () => {
  const lightAndBig = (): FakeProvider =>
    new FakeProvider({ models: [model('big'), model('light')], starterModel: 'light', script: [textReply('no workflow here')] });

  it("drafts on the provider's light starter model, not the biggest one it lists first", async () => {
    const provider = lightAndBig();
    await draftOn(provider);
    expect(provider.received[0]?.model).toBe('light');
  });

  it('drafts on the model the host set for drafting, when it set one', async () => {
    const provider = lightAndBig();
    await draftOn(provider, { draftModel: 'big' });
    expect(provider.received[0]?.model).toBe('big');
  });
});
