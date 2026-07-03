import { defineTool, z, type ToolDef } from '@moxxy/sdk';
import { shouldFire } from '../filter.js';
import { renderPrompt } from '../template.js';
import { WEBHOOKS_STORE_GLOB, type ResolvedToolDeps } from './shared.js';

export function defineWebhookTestTool(deps: ResolvedToolDeps): ToolDef {
  const { store, dispatcher } = deps;
  return defineTool({
    name: 'webhook_test',
    description:
      'Fire a webhook trigger right now with a synthetic body + headers, bypassing the ' +
      'HTTP listener and signature verification. Filters DO still apply — a synthetic ' +
      'delivery the filters would drop returns `{ ok: true, filtered: true }` WITHOUT ' +
      'firing the prompt, exactly as a real delivery would. Use this to validate the ' +
      "prompt + tools (and the filters) without waiting for the external system's first POST.",
    inputSchema: z.object({
      id: z.string().min(1),
      body: z.string().default('{}'),
      headers: z.record(z.string()).default({}),
    }),
    permission: { action: 'prompt' },
    // A test fire runs the trigger's prompt as a REAL turn on the active
    // session before returning — model/provider calls happen inside this
    // handler (hence net 'any' and the generous wall clock). Tools the fired
    // turn invokes re-enter the session's tool pipeline and are bounded by
    // their own capability specs, not this one.
    isolation: {
      capabilities: {
        fs: {
          read: [WEBHOOKS_STORE_GLOB],
          write: [WEBHOOKS_STORE_GLOB, '~/.moxxy/inbox/webhooks/**'],
        },
        net: { mode: 'any' },
        timeMs: 600_000,
      },
    },
    handler: async ({ id, body, headers }) => {
      const trigger = await store.get(id);
      if (!trigger) throw new Error(`no trigger with id "${id}"`);
      const bodyBuf = Buffer.from(body, 'utf8');
      // Apply the trigger's filters exactly as the live HTTP path does (server.ts):
      // the tool advertises "Filters DO still apply", so a synthetic delivery the
      // filters would drop must NOT fire — otherwise the test reports a false
      // positive and the agent ships a trigger that never fires in production.
      if (!shouldFire(trigger.filters, { headers, body: bodyBuf })) {
        return {
          ok: true,
          filtered: true,
          fired: false,
          inboxPath: null,
          text: '',
        };
      }
      const prompt = renderPrompt({
        trigger,
        headers,
        body: bodyBuf,
        method: 'POST',
        path: `/webhook/${trigger.id}`,
        firedAt: new Date(),
      });
      const outcome = await dispatcher.fire(trigger, prompt, null);
      return {
        ok: outcome.ok,
        filtered: false,
        fired: true,
        inboxPath: outcome.inboxPath ?? null,
        ...(outcome.error ? { error: outcome.error } : {}),
        text: outcome.text.slice(0, 4000),
      };
    },
  });
}
