import type { MoxxyConfig } from '@moxxy/config';

/**
 * The curated /settings knob table — pure data so the panel logic is fully
 * unit-testable and the paths are validated against the schema in tests.
 * NOT a generic YAML editor: each knob names one dot-path, how to render its
 * current value, and what picking it writes (booleans toggle, enums cycle).
 * `link` rows re-open an existing picker; `readonly` rows only display.
 */
export interface SettingsKnob {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly kind: 'boolean' | 'enum' | 'link' | 'readonly';
  /** Config dot-path (user scope). Absent for link rows. */
  readonly dotPath?: string;
  /** Current value, rendered as the option badge. */
  readonly current: (cfg: MoxxyConfig) => string;
  /** The value to persist when picked (booleans toggle, enums cycle). */
  readonly next?: (cfg: MoxxyConfig) => unknown;
  /** For link rows: which picker to open. */
  readonly opens?: 'model' | 'mode';
}

const onOff = (v: boolean | undefined, dflt: boolean): string =>
  (v ?? dflt) ? 'on' : 'off';

/** `reasoning` is boolean | {effort} — render + cycle off → on → high → off. */
function reasoningLabel(cfg: MoxxyConfig): string {
  const r = cfg.context?.reasoning;
  if (r === undefined || r === false) return 'off';
  if (r === true) return 'on';
  return r.effort ? `on (${r.effort})` : 'on';
}

function reasoningNext(cfg: MoxxyConfig): unknown {
  const r = cfg.context?.reasoning;
  if (r === undefined || r === false) return true;
  if (r === true) return { effort: 'high' };
  return false;
}

export const SETTINGS_KNOBS: ReadonlyArray<SettingsKnob> = [
  {
    id: 'model',
    label: 'Provider & model',
    description: 'open the /model picker',
    kind: 'link',
    opens: 'model',
    current: () => '',
  },
  {
    id: 'mode',
    label: 'Default mode',
    description: 'open the /mode picker',
    kind: 'link',
    opens: 'mode',
    current: () => '',
  },
  {
    id: 'reasoning',
    label: 'Model reasoning',
    description: 'stream provider reasoning; cycles off → on → on (high)',
    kind: 'enum',
    dotPath: 'context.reasoning',
    current: reasoningLabel,
    next: reasoningNext,
  },
  {
    id: 'caching',
    label: 'Prompt caching',
    description: 'provider prompt-cache breakpoints (lossless; default on)',
    kind: 'boolean',
    dotPath: 'context.caching',
    current: (c) => onOff(c.context?.caching, true),
    next: (c) => !(c.context?.caching ?? true),
  },
  {
    id: 'elision',
    label: 'Context elision',
    description: 'turn-boundary elision of old tool output (default on)',
    kind: 'boolean',
    dotPath: 'context.elision.enabled',
    current: (c) => onOff(c.context?.elision?.enabled, true),
    next: (c) => !(c.context?.elision?.enabled ?? true),
  },
  {
    id: 'lazy-tools',
    label: 'Lazy tools',
    description: 'defer tool schemas out of the system prompt (default off)',
    kind: 'boolean',
    dotPath: 'context.lazyTools',
    current: (c) => onOff(c.context?.lazyTools, false),
    next: (c) => !(c.context?.lazyTools ?? false),
  },
  {
    id: 'loop-guard',
    label: 'Stuck-loop guard',
    description: 'bail a turn early on repeated identical tool calls (default on)',
    kind: 'boolean',
    dotPath: 'context.loopGuard.enabled',
    current: (c) => onOff(c.context?.loopGuard?.enabled, true),
    next: (c) => !(c.context?.loopGuard?.enabled ?? true),
  },
  {
    id: 'security',
    label: 'Plugin security',
    description: 'opt-in capability isolation for plugin tools (default off)',
    kind: 'boolean',
    dotPath: 'security.enabled',
    current: (c) => onOff(c.security?.enabled, false),
    next: (c) => !(c.security?.enabled ?? false),
  },
  {
    id: 'tui-theme',
    label: 'TUI theme',
    description: 'default palette or mono (NO_COLOR-style)',
    kind: 'enum',
    dotPath: 'tui.theme',
    current: (c) => c.tui?.theme ?? 'default',
    next: (c) => ((c.tui?.theme ?? 'default') === 'default' ? 'mono' : 'default'),
  },
  {
    id: 'tui-hints',
    label: 'Footer hints',
    description: 'the dim key-hint row under the input',
    kind: 'boolean',
    dotPath: 'tui.hints',
    current: (c) => onOff(c.tui?.hints, true),
    next: (c) => !(c.tui?.hints ?? true),
  },
  {
    id: 'system-prompt',
    label: 'System prompt',
    description: 'edit `systemPrompt` in ~/.moxxy/config.yaml',
    kind: 'readonly',
    dotPath: 'systemPrompt',
    current: (c) =>
      c.systemPrompt ? `set (${c.systemPrompt.length} chars)` : '(default)',
  },
  {
    id: 'tui-keys',
    label: 'Hotkey overrides',
    description: 'edit `tui.keys` in ~/.moxxy/config.yaml — applies next boot',
    kind: 'readonly',
    dotPath: 'tui.keys',
    current: (c) => (c.tui?.keys ? JSON.stringify(c.tui.keys) : '(defaults)'),
  },
];

export function findKnob(id: string): SettingsKnob | undefined {
  return SETTINGS_KNOBS.find((k) => k.id === id);
}
