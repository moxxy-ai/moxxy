import { runTurn, type Session } from '@moxxy/core';
import type { SchedulePromptRunner } from '@moxxy/plugin-scheduler';

/**
 * Bridge the scheduler plugin's prompt-runner contract to a live Session.
 *
 * Reuses the active session for v1 — scheduled prompts appear in
 * conversation history so the user sees what fired. An isolated
 * child-session runner is the obvious follow-up to avoid context
 * pollution.
 */
export function buildSchedulerRunner(session: Session): SchedulePromptRunner {
  return {
    runPrompt: async ({ prompt, model }) => {
      let text = '';
      let lastError: string | null = null;
      try {
        for await (const event of runTurn(session, prompt, model ? { model } : {})) {
          if (event.type === 'assistant_message') {
            text = event.content;
            // The latest assistant_message is authoritative for the final
            // outcome: a later successful round must clear an earlier round's
            // error stop reason, otherwise a recovered turn reports as failed.
            lastError = event.stopReason === 'error' ? 'turn ended with error stop reason' : null;
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
