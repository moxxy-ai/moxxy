/**
 * Human-in-the-loop commands for the active collaboration. They run in the
 * coordinator's Session process and look up the live hub from the
 * process-local registry — the no-protocol-bump path for stepping in. The
 * desktop drives them via the existing `session.runCommand` IPC; the TUI via
 * `/collab_*`.
 *
 *   /collab_say <to|all> <message>   — message a teammate or the whole team
 *   /collab_direct <message>         — push an authoritative steering directive
 *   /collab_pause                    — pause the team at their next checkpoint
 *   /collab_resume                   — resume a paused team
 */

import { defineCommand, type CommandDef, type CommandOutput } from '@moxxy/sdk';
import { getActiveHub } from './active-hubs.js';
import type { CollaborationHub } from './hub.js';

function withHub(sessionId: unknown, fn: (hub: CollaborationHub) => CommandOutput): CommandOutput {
  const hub = getActiveHub(String(sessionId));
  if (!hub) return { kind: 'error', message: 'No active collaboration in this session.' };
  return fn(hub);
}

export const collabSayCommand: CommandDef = defineCommand({
  name: 'collab_say',
  description: 'Send a message into the active collaboration (to one agent id, or "all").',
  argumentHint: '<to|all> <message>',
  handler: (ctx) =>
    withHub(ctx.sessionId, (hub) => {
      const trimmed = ctx.args.trim();
      const sp = trimmed.indexOf(' ');
      if (sp < 0) return { kind: 'error', message: 'Usage: /collab_say <to|all> <message>' };
      const to = trimmed.slice(0, sp);
      const body = trimmed.slice(sp + 1).trim();
      if (!body) return { kind: 'error', message: 'Message body is empty.' };
      hub.post('human', to, body);
      return { kind: 'text', text: `Sent to ${to === 'all' ? 'the whole team' : to}.` };
    }),
});

export const collabDirectCommand: CommandDef = defineCommand({
  name: 'collab_direct',
  description: 'Push an authoritative steering directive to the whole team (overrides their current plan).',
  argumentHint: '<directive>',
  handler: (ctx) =>
    withHub(ctx.sessionId, (hub) => {
      const directive = ctx.args.trim();
      if (!directive) return { kind: 'error', message: 'Usage: /collab_direct <directive>' };
      hub.setControl({ directive });
      return { kind: 'text', text: 'Directive sent to the team.' };
    }),
});

export const collabPauseCommand: CommandDef = defineCommand({
  name: 'collab_pause',
  description: 'Pause the team — agents finish their current step and idle until resumed.',
  handler: (ctx) =>
    withHub(ctx.sessionId, (hub) => {
      hub.setControl({ paused: true });
      return { kind: 'text', text: 'Team paused. Use /collab_resume to continue.' };
    }),
});

export const collabResumeCommand: CommandDef = defineCommand({
  name: 'collab_resume',
  description: 'Resume a paused collaboration.',
  handler: (ctx) =>
    withHub(ctx.sessionId, (hub) => {
      hub.setControl({ paused: false });
      return { kind: 'text', text: 'Team resumed.' };
    }),
});

export const collabCommands: ReadonlyArray<CommandDef> = [
  collabSayCommand,
  collabDirectCommand,
  collabPauseCommand,
  collabResumeCommand,
];
