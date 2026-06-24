import path from 'node:path';
import type { TriggerOrigin } from '@moxxy/sdk';
import { moxxyPath, writeFileAtomic } from '@moxxy/sdk/server';
import type { ScheduleEntry, ScheduleStore } from './store.js';

/**
 * Fires a scheduled prompt and persists the outcome. The actual
 * prompt-running is opaque to the plugin — the bootstrap supplies a
 * `runPrompt` closure that knows how to spin up an isolated session,
 * dispatch the prompt, and return the final assistant text.
 *
 * Keeping the session-spin-up outside the plugin preserves the core
 * invariant ("@moxxy/core never imports a plugin") and lets different
 * hosts (TUI, daemon mode, tests) inject their own runner.
 */

export interface SchedulePromptResult {
  readonly text: string;
  readonly error?: string;
}

export interface SchedulePromptRunner {
  runPrompt(input: {
    prompt: string;
    model?: string;
    scheduleName: string;
    /**
     * Provenance for the fired turn, so the host can render a compact marker
     * instead of the raw prompt. A workflow-mirror schedule reports
     * `kind:'workflow'`; an ordinary schedule reports `kind:'schedule'`.
     */
    origin?: TriggerOrigin;
  }): Promise<SchedulePromptResult>;
}

export interface ScheduleRunOutcome {
  readonly ok: boolean;
  readonly inboxPath?: string;
  readonly text: string;
  readonly error?: string;
}

export interface InboxOptions {
  /** Override directory — primarily for tests. */
  readonly dir?: string;
}

export function defaultInboxDir(): string {
  return moxxyPath('inbox');
}

async function writeInbox(
  entry: ScheduleEntry,
  result: SchedulePromptResult,
  opts: InboxOptions = {},
): Promise<string> {
  const dir = opts.dir ?? defaultInboxDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${stamp}-${entry.name}.md`);
  const header = [
    `---`,
    `schedule: ${entry.name}`,
    `firedAt: ${new Date().toISOString()}`,
    entry.cron ? `cron: "${entry.cron}"` : `runAt: ${entry.runAt}`,
    entry.channel ? `channel: ${entry.channel}` : null,
    `outcome: ${result.error ? 'error' : 'ok'}`,
    `---`,
    '',
  ]
    .filter((line) => line !== null)
    .join('\n');
  const body = result.error ? `**error:** ${result.error}\n\n${result.text}` : result.text;
  await writeFileAtomic(file, header + body + '\n');
  return file;
}

/**
 * Fire a single schedule and persist the outcome (lastRunAt/lastResult).
 * One-shot (`runAt`) entries get disabled after their single run so the
 * poller stops considering them. The next cron fire is derived on demand by
 * `describeEntry`/`isDue` from the stored entry — the single source of truth —
 * so it is deliberately NOT recomputed here.
 */
export async function runSchedule(
  entry: ScheduleEntry,
  runner: SchedulePromptRunner,
  store: ScheduleStore,
  inboxOpts: InboxOptions = {},
): Promise<ScheduleRunOutcome> {
  let result: SchedulePromptResult;
  try {
    result = await runner.runPrompt({
      prompt: entry.prompt,
      ...(entry.model ? { model: entry.model } : {}),
      scheduleName: entry.name,
      // A workflow-mirror row (source='workflow') reads as "Workflow ran";
      // every other schedule reads as "Schedule fired".
      origin:
        entry.source === 'workflow' && entry.workflowName
          ? { kind: 'workflow', name: entry.workflowName }
          : { kind: 'schedule', name: entry.name },
    });
  } catch (err) {
    result = {
      text: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  let inboxPath: string | undefined;
  try {
    inboxPath = await writeInbox(entry, result, inboxOpts);
  } catch {
    // Inbox failure is non-fatal — schedule outcome still counted.
  }

  const now = Date.now();
  const isOneShot = !!entry.runAt && !entry.cron;
  const patch: Partial<ScheduleEntry> = {
    lastRunAt: now,
    lastResult: result.error ? 'error' : 'ok',
    ...(result.error ? { lastError: result.error.slice(0, 500) } : { lastError: undefined }),
    ...(isOneShot ? { enabled: false } : {}),
  };
  await store.update(entry.id, patch);

  return {
    ok: !result.error,
    text: result.text,
    ...(result.error ? { error: result.error } : {}),
    ...(inboxPath ? { inboxPath } : {}),
  };
}
