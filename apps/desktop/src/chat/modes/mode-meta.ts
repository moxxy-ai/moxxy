/**
 * How a mode is named and explained wherever the desktop shows one: the
 * composer's chip, the mode menu, the empty field. The runner only knows a
 * mode by its id; a mode this file has never heard of is shown by that id,
 * tidied, with nothing claimed about what it does.
 */

export const DEFAULT_MODE = 'default';

export interface ModeMeta {
  readonly label: string;
  /** What the mode does, in one line. Empty for a mode we cannot speak for. */
  readonly hint: string;
  /** The one thing to keep in mind while it is on, said beside its name. */
  readonly note?: string;
  /** What the empty field asks for. */
  readonly placeholder?: string;
  /** A mode that acts without asking is a caution. */
  readonly tone?: 'warn';
}

export const GOAL_PLACEHOLDER = 'Set your goal — Moxxy works until it is reached…';

const KNOWN: Readonly<Record<string, ModeMeta>> = {
  default: { label: 'Default', hint: 'Asks before it acts' },
  plan: {
    label: 'Plan',
    hint: 'Reads only, then writes a plan',
    note: 'read-only',
    placeholder: 'Describe what to plan…',
  },
  goal: {
    label: 'Goal',
    hint: 'Works unattended until it is done',
    note: 'unattended',
    placeholder: GOAL_PLACEHOLDER,
    tone: 'warn',
  },
  research: {
    label: 'Research',
    hint: 'Researches in parallel, then writes a cited report',
    placeholder: 'Ask a research question…',
  },
};

export function modeMeta(mode: string): ModeMeta {
  const known = KNOWN[mode];
  if (known) return known;
  const words = mode.replace(/[-_]+/g, ' ').trim();
  return { label: words.charAt(0).toUpperCase() + words.slice(1), hint: '' };
}
