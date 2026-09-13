import { runTurn, type Session } from '@moxxy/core';
import type { SchedulePromptRunner } from '@moxxy/plugin-scheduler';
import type { WorkflowRunner } from './build-workflow-runner.js';

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
    runPrompt: async ({ prompt, model, origin, signal }) => {
      if (origin?.kind === 'workflow') {
        const runner = session.services.get<WorkflowRunner>('workflowRunner');
        if (!runner) return { text: '', error: 'Workflow runner is not ready' };
        try {
          const result = await runner.runNow({
            name: origin.name,
            trigger: 'schedule',
            ...(model ? { model } : {}),
            ...(signal ? { signal } : {}),
          });
          return { text: result.output, ...(result.status === 'cancelled' ? { cancelled: true } : {}), ...(result.error ? { error: result.error } : {}) };
        } catch (error) {
          return { text: '', error: error instanceof Error ? error.message : String(error) };
        }
      }
      const turnId = session.startTurn().turnId;
      const execute = async () => {
        let text = '';
        let lastError: string | null = null;
        try {
          for await (const event of runTurn(session, prompt, {
            turnId,
            ...(origin ? { origin } : {}),
            ...(model ? { model } : {}),
          })) {
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
      };
      return execute();
    },
  };
}
