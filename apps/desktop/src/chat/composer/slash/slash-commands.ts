/**
 * What the composer offers after a slash: the modes, the skills, the workflows
 * and the run's actions, narrowed by the word being typed. Pure rules; what a pick does is
 * `useSlashMenu`.
 */

import { mentionOptions } from '@moxxy/client-core';
import type { SkillInfo } from '@moxxy/sdk';
import { humanize } from '../../command-palette/steppers';
import type { CommandInfo } from '../../command-palette/types';
import { modeMeta } from '../../modes/mode-meta';

export type SlashAction =
  | { readonly kind: 'mode'; readonly mode: string }
  /** Goal mode needs an objective, so it is armed, not switched to. */
  | { readonly kind: 'goal' }
  | { readonly kind: 'auto-approve' }
  | { readonly kind: 'skill'; readonly token: string }
  /** Run through the run's own workflows action, as `/workflows run <name>` does. */
  | { readonly kind: 'workflow'; readonly command: CommandInfo; readonly name: string }
  | { readonly kind: 'command'; readonly command: CommandInfo };

export type SlashSection = 'Modes' | 'Skills' | 'Workflows' | 'Actions';

/** What the menu needs to know of a workflow. */
export interface SlashWorkflow {
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
}

export interface SlashOption {
  readonly section: SlashSection;
  /** What is typed after the slash. */
  readonly name: string;
  readonly aliases: ReadonlyArray<string>;
  readonly label: string;
  readonly hint: string;
  /** The mode that is on, or a switch that is on. */
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly action: SlashAction;
}

export interface SlashSource {
  readonly modes: ReadonlyArray<string>;
  readonly activeMode: string | null;
  /** A turn is running: the mode cannot change under it. */
  readonly modeBusy: boolean;
  readonly autoApprove: boolean;
  readonly skills: ReadonlyArray<SkillInfo>;
  readonly commands: ReadonlyArray<CommandInfo>;
  readonly workflows: ReadonlyArray<SlashWorkflow>;
}

/** Actions of the terminal client that do nothing in a window: it has no process to quit, and the menu is its help. */
const NOT_HERE: ReadonlySet<string> = new Set(['exit', 'help']);
const CHANNEL = 'desktop';
/** Skills shown before a word narrows them, so the actions under them stay in reach. */
const SKILLS_UNFILTERED = 6;
const SKILLS_FILTERED = 8;
/** The action a workflow is run through; without it the run has no workflows. */
const WORKFLOWS_ACTION = 'workflows';
const WORKFLOWS_UNFILTERED = 6;

/** The word after a slash that starts the draft, while the draft is that one word. */
export function slashQuery(draft: string): string | null {
  return /^\/([\p{L}\p{N}_-]*)$/u.exec(draft)?.[1] ?? null;
}

function modeOptions(source: SlashSource): SlashOption[] {
  return source.modes.map((mode) => {
    const meta = modeMeta(mode);
    return {
      section: 'Modes',
      name: mode,
      aliases: [],
      label: meta.label,
      hint: meta.hint,
      active: mode === source.activeMode,
      disabled: source.modeBusy,
      action: mode === 'goal' ? { kind: 'goal' } : { kind: 'mode', mode },
    };
  });
}

function actionOptions(source: SlashSource): SlashOption[] {
  const commands = source.commands.filter(
    (command) => !NOT_HERE.has(command.name) && (!command.channels || command.channels.includes(CHANNEL)),
  );
  return [
    {
      section: 'Actions',
      name: 'auto-approve',
      aliases: ['yolo'],
      label: 'Auto-approve',
      hint: source.autoApprove ? 'On: tools run without asking' : 'Run tools without asking',
      active: source.autoApprove,
      action: { kind: 'auto-approve' },
    },
    ...commands.map((command): SlashOption => ({
      section: 'Actions',
      name: command.name,
      aliases: command.aliases ?? [],
      label: humanize(command.name),
      hint: command.description ?? '',
      action: { kind: 'command', command },
    })),
  ];
}

/** Names that start with the word, then names that only hold it; the given order within each. */
function narrowed(options: ReadonlyArray<SlashOption>, query: string): SlashOption[] {
  const wanted = query.toLowerCase();
  if (wanted === '') return [...options];
  const names = (option: SlashOption): string[] =>
    [option.name, ...option.aliases, option.label].map((name) => name.toLowerCase());
  const starts = options.filter((option) => names(option).some((name) => name.startsWith(wanted)));
  const holds = options.filter(
    (option) => !starts.includes(option) && names(option).some((name) => name.includes(wanted)),
  );
  return [...starts, ...holds];
}

function skillOptions(source: SlashSource, query: string): SlashOption[] {
  const limit = query === '' ? SKILLS_UNFILTERED : SKILLS_FILTERED;
  return mentionOptions(source.skills, query, limit).map((skill) => ({
    section: 'Skills',
    name: skill.token,
    aliases: [],
    label: skill.label,
    hint: skill.description,
    action: { kind: 'skill', token: skill.token },
  }));
}

/** The workflows that are on; one that is off cannot run, so it is not offered. */
function workflowOptions(source: SlashSource, query: string): SlashOption[] {
  const command = source.commands.find((candidate) => candidate.name === WORKFLOWS_ACTION);
  if (!command) return [];
  const options = source.workflows
    .filter((workflow) => workflow.enabled)
    .map((workflow): SlashOption => ({
      section: 'Workflows',
      name: workflow.name,
      // Found by its own name only: `/workflows` and Enter must reach the action, not start a run.
      aliases: [],
      label: workflow.name,
      hint: workflow.description,
      action: { kind: 'workflow', command, name: workflow.name },
    }));
  return query === '' ? options.slice(0, WORKFLOWS_UNFILTERED) : narrowed(options, query);
}

export function slashOptions(source: SlashSource, query: string): SlashOption[] {
  return [
    ...narrowed(modeOptions(source), query),
    ...skillOptions(source, query),
    ...workflowOptions(source, query),
    ...narrowed(actionOptions(source), query),
  ];
}

/**
 * A typed line that names a mode or an action and gives it words
 * (`/goal ship it`). A skill is called by its @ mention, and anything else
 * that starts with a slash (a path) is a prompt.
 */
export function slashInvocation(
  draft: string,
  source: SlashSource,
): { readonly option: SlashOption; readonly rest: string } | null {
  const typed = /^\/([\p{L}\p{N}_-]+)\s+([\s\S]*)$/u.exec(draft);
  if (!typed) return null;
  const word = (typed[1] ?? '').toLowerCase();
  const option = [...modeOptions(source), ...actionOptions(source)].find(
    (candidate) => candidate.name.toLowerCase() === word || candidate.aliases.some((alias) => alias.toLowerCase() === word),
  );
  return option ? { option, rest: (typed[2] ?? '').trim() } : null;
}
