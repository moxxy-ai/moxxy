import { defineTool, z, type ToolDef } from '@moxxy/sdk';
import { renderPrompt } from '../template.js';
import type { ResolvedToolDeps } from './shared.js';

export function defineWebhookTestTool(deps: ResolvedToolDeps): ToolDef {
  const { store, dispatcher } = deps;
  return defineTool({
    name: 'webhook_test',
    description:
      'Fire a webhook trigger right now with a synthetic body + headers, bypassing the ' +
      'HTTP listener and signature verification. Filters DO still apply. Use this to ' +
      "validate the prompt + tools without waiting for the external system's first POST.",
    inputSchema: z.object({
      id: z.string().min(1),
      body: z.string().default('{}'),
      headers: z.record(z.string()).default({}),
    }),
    permission: { action: 'prompt' },
    handler: async ({ id, body, headers }) => {
      const trigger = await store.get(id);
      if (!trigger) throw new Error(`no trigger with id "${id}"`);
      const prompt = renderPrompt({
        trigger,
        headers,
        body: Buffer.from(body, 'utf8'),
        method: 'POST',
        path: `/webhook/${trigger.id}`,
        firedAt: new Date(),
      });
      const outcome = await dispatcher.fire(trigger, prompt, null);
      return {
        ok: outcome.ok,
        inboxPath: outcome.inboxPath ?? null,
        ...(outcome.error ? { error: outcome.error } : {}),
        text: outcome.text.slice(0, 4000),
      };
    },
  });
}
