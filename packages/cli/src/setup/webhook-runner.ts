import { runTurn, type Session } from '@moxxy/core';
import type { WebhookPromptRunner } from '@moxxy/plugin-webhooks';

/**
 * Bridge the webhooks plugin's prompt-runner contract to a live Session.
 *
 * v1 reuses the active session so webhook fires land in the visible
 * event log (same approach as the scheduler runner). The trigger's
 * `allowedTools` is informational here — actual permission gating
 * happens through the Session's active PermissionResolver. Hosts that
 * want hard isolation per fire should swap this for a child-session
 * runner.
 */
export function buildWebhookRunner(session: Session): WebhookPromptRunner {
  return {
    runPrompt: async ({ prompt, model }) => {
      let text = '';
      let lastError: string | null = null;
      try {
        for await (const event of runTurn(session, prompt, model ? { model } : {})) {
          if (event.type === 'assistant_message') {
            text = event.content;
            if (event.stopReason === 'error') lastError = 'turn ended with error stop reason';
          } else if (event.type === 'error') {
            lastError = event.message;
          }
        }
      } catch (err) {
        return { text, error: err instanceof Error ? err.message : String(err) };
      }
      return lastError ? { text, error: lastError } : { text };
    },
  };
}
