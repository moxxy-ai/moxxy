import { defineTool, z, type ToolDef } from '@moxxy/sdk';
import { buildSetupGuide } from './setup-guide.js';
import type { ResolvedToolDeps } from './shared.js';

export function defineWebhookSetupGuideTool(deps: ResolvedToolDeps): ToolDef {
  const { store, config } = deps;
  return defineTool({
    name: 'webhook_setup_guide',
    description:
      'Return a step-by-step setup script tailored to the current state. The agent ' +
      'treats this as a checklist: each step has a `title`, an `askUser` question to ' +
      'pose, and `recordAs` indicating which `webhook_create` field the answer becomes. ' +
      'Use this whenever a user wants to wire up a webhook but does NOT know the ' +
      "specifics of the external system's signing scheme, event names, or secret format.",
    inputSchema: z.object({}),
    handler: async () => buildSetupGuide({ store, config }),
  });
}
