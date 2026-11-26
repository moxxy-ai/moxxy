import type { AgentScheduledWakeup } from '@moxxy/sdk';
import { oneLine, summarizeArgs, wakeupCountdown, type AgentWorkItem, type AgentWorkStatus } from '@moxxy/chat-model';

/** How a work's state reads in the pane. */
export const STATUS_TEXT: Readonly<Record<AgentWorkStatus, string>> = {
  running: 'Running',
  completed: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
};

/** One line under a work's name: what kind it is, and how long it ran or has been running. */
export function workMeta(item: AgentWorkItem, nowMs: number): string {
  const kind = workKind(item.kind, item.agentType);
  const took = duration(item, nowMs);
  return took ? `${kind} · ${took}` : kind;
}

/** What kind of work it is, in a word: a command, or the kind a helper was started as. */
export function workKind(kind: AgentWorkItem['kind'], agentType: string | null): string {
  if (kind === 'command') return 'Command';
  return agentType && agentType !== 'default' ? agentType : 'Helper';
}

function duration(item: AgentWorkItem, nowMs: number): string | null {
  if (item.startedAtMs === null) return null;
  const end = item.endedAtMs ?? (item.status === 'running' ? nowMs : null);
  if (end === null) return null;
  const seconds = Math.max(0, Math.round((end - item.startedAtMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** A tool call as one short line: what it was given. */
export function toolLine(input: unknown): string {
  return oneLine(summarizeArgs(input));
}

/** A time of day as this computer writes it ("22:59"). */
export function clockTime(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(ms);
}

/** One line under a scheduled wakeup: when the agent comes back, and how soon. */
export function wakeupMeta(wakeup: AgentScheduledWakeup, nowMs: number): string {
  if (wakeup.dueAtMs === null) return wakeup.recurring ? 'Repeats' : 'Scheduled';
  const when = `${wakeup.recurring ? 'Next at' : 'Back at'} ${clockTime(wakeup.dueAtMs)}`;
  return `${when} · ${wakeupCountdown(wakeup.dueAtMs, nowMs)}`;
}
