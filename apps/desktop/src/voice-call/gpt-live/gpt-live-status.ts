import type { VoiceOperationKind } from '@moxxy/client-core';
import { redactSecretText } from '@moxxy/sdk/redact';

/**
 * What GPT-Live knows about a running agent task, so it can answer "how is it
 * going?" concretely: the task in the user's words, how long it has run, the
 * step it is on, the last few kinds of work done, and the agent's own plan.
 * Only names reach the model (a command line, a file name, a site), never
 * tool output or file contents.
 */
export interface AgentTaskStatus {
  readonly task: string;
  readonly startedAt: number;
  /** Tool calls so far in the task. */
  readonly steps: number;
  readonly current?: { readonly kind: VoiceOperationKind; readonly detail?: string };
  /** Kinds of work already done, oldest first, without repeats. */
  readonly done: ReadonlyArray<VoiceOperationKind>;
  readonly plan?: { readonly done: number; readonly total: number; readonly current?: string };
}

export const OPERATION_PHRASE: Readonly<Record<VoiceOperationKind, string>> = {
  'web-search': 'searching the web',
  'project-read': 'reading the project',
  editing: 'editing files',
  verification: 'running checks or tests',
  command: 'running a command',
  application: 'using an app on screen',
  delegation: 'working with a sub-agent',
  generic: 'using a tool',
};

const MAX_TASK_CHARS = 80;
const MAX_DETAIL_CHARS = 60;
const MAX_DONE_KINDS = 3;

export function describeAgentStatus(status: AgentTaskStatus, now: number): string {
  const doing = status.current
    ? `the agent is ${OPERATION_PHRASE[status.current.kind]}${status.current.detail ? ` (${status.current.detail})` : ''}`
    : 'the agent is working on it';
  const sentences = [
    `Progress of the running Moxxy task "${shorten(status.task, MAX_TASK_CHARS)}" (running for ${elapsed(now - status.startedAt)}): step ${status.steps}, ${doing}.`,
  ];
  if (status.plan && status.plan.total > 0) {
    const current = status.plan.current ? `, now: ${shorten(status.plan.current, MAX_TASK_CHARS)}` : '';
    sentences.push(`Plan: ${status.plan.done} of ${status.plan.total} steps done${current}.`);
  } else if (status.done.length > 0) {
    const done = status.done.slice(-MAX_DONE_KINDS).map((kind) => OPERATION_PHRASE[kind]).join(', ');
    sentences.push(`Done so far: ${done}.`);
  }
  return sentences.join(' ');
}

/** The one name worth saying about a tool call: its command, file or site. */
export function operationDetail(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const fields = input as Record<string, unknown>;
  const command = typeof fields.command === 'string' ? fields.command : fields.cmd;
  if (typeof command === 'string') {
    const line = command.split('\n', 1)[0]?.trim();
    const safe = line?.replace(/(?:[A-Z_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z_]*=|--(?:api-key|token|password|secret)(?:=|\s+))(?:"[^"]*"|'[^']*'|[^\s]+)/gi, '[credential]').replace(/\bsk-[A-Za-z0-9_-]+/g, '[key]');
    return safe ? shorten(safe, MAX_DETAIL_CHARS) : undefined;
  }
  const file = typeof fields.file_path === 'string' ? fields.file_path : fields.path;
  if (typeof file === 'string' && file.trim()) {
    return shorten(file.split(/[\\/]/).filter(Boolean).at(-1) ?? file, MAX_DETAIL_CHARS);
  }
  if (typeof fields.url === 'string') {
    try {
      return new URL(fields.url).hostname;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function elapsed(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  return minutes < 1 ? 'under a minute' : `${minutes} min`;
}

function shorten(text: string, max: number): string {
  const safe = redactSecretText(text);
  return safe.length <= max ? safe : `${safe.slice(0, max - 1)}…`;
}
