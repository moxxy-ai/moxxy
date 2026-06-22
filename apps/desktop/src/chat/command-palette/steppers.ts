/**
 * Pure helpers for the actions palette: the per-action arg schemas,
 * shell-style arg quoting, and the friendly-label humanizer. No React,
 * no IPC — kept dependency-free so the palette container and the args
 * form can both pull from one place.
 */

import type { ArgStep } from './types';

/** An arg schema for a registered (single-token) command. Some commands —
 *  like `vault` — dispatch a fixed subcommand parsed from their arg string,
 *  so the action picker prepends it to the user's values. */
interface CommandStepper {
  /** Subcommand token to prepend to the dispatched arg string (e.g. `set`). */
  readonly subcommand?: string;
  readonly steps: ReadonlyArray<ArgStep>;
}

/**
 * Args schemas keyed by the REGISTERED single-token command name (as it
 * appears in `session.info`). Every slash command the runner exposes is a
 * single token; subcommands (`vault set`) are parsed from the arg string by
 * the command's own handler, so we model them as an explicit `subcommand`
 * rather than a multi-token key (which never exact-matches a real command).
 */
const COMMAND_STEPPERS: Record<string, CommandStepper> = {
  vault: {
    subcommand: 'set',
    steps: [
      { label: 'Vault key', placeholder: 'OPENAI_API_KEY', help: 'The env-var name the agent looks up.' },
      { label: 'Value', placeholder: 'sk-…', secret: true, help: 'Stored encrypted in the vault.' },
    ],
  },
};

export function stepsForCommand(commandName: string): ReadonlyArray<ArgStep> {
  return COMMAND_STEPPERS[commandName]?.steps ?? [];
}

/** The subcommand token to prepend when dispatching this command, if any. */
export function subcommandForCommand(commandName: string): string | undefined {
  return COMMAND_STEPPERS[commandName]?.subcommand;
}

/**
 * Shell-style quote a value for the runner's single-string arg parser. The
 * value can carry a SECRET (`vault set <key> <value>`), so corruption here can
 * silently mangle a stored credential. We:
 *   - leave only the safe allow-list bare, and require the FIRST char to not be
 *     `-` so a value like `--flag` is always quoted and can't be parsed as an
 *     option (internal `-`, as in `sk-abc`, stays bare);
 *   - otherwise wrap in double quotes, escaping BACKSLASHES FIRST and then
 *     quotes, so a trailing `\` (e.g. `a\` → `"a\\"`) round-trips instead of
 *     the parser reading `\"` as an escaped quote and eating the next token.
 */
export function quote(v: string): string {
  if (/^[A-Za-z0-9_./@][A-Za-z0-9_\-./@]*$/.test(v)) return v;
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Convert "vault set" / "mode use" → "Vault set" / "Mode use" for
 *  the user-facing label. The runner registers these with terminal
 *  syntax that doesn't read well in a friendly action picker. */
export function humanize(name: string): string {
  return name
    .split(' ')
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}
