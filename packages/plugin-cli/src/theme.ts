/**
 * Centralized palette for the Moxxy TUI. Grok-style monochrome:
 * default-color text for active content, dim gray for chrome (borders,
 * footer hints, labels), and a small set of accent colors reserved for
 * state changes the user must notice (busy=yellow, error=red).
 *
 * Components import these tokens instead of hardcoding `color="cyan"`
 * etc., so a future palette tweak is a single-file change.
 */

/**
 * Glyphs used across components. The diamond pair (`◆`/`◇`) is the
 * shared "filled vs pending" indicator — boot checklist, phase markers
 * in the chat scrollback, and any future progress lists all reuse it.
 */
export const Glyphs = {
  /** Completed step / executed action. */
  filled: '◆',
  /** Pending step / waiting action. */
  pending: '◇',
  /** Inline prompt marker (user message, input cursor prefix). */
  prompt: '›',
  /** Waiting / spinner-adjacent indicator. */
  waiting: '∴',
  /** Context-meter "up arrow" used in the header bar. */
  contextUp: '↑',
  /** Cancel hint shown next to turn metrics. */
  cancel: '[×]',
  /** Vertical separator for footer key-hints. */
  hintSep: '│',
  /** Mid-dot separator. */
  midDot: '·',
} as const;

/** Ink color names mapped to semantic roles. */
export const Colors = {
  /** Borders, footer hints, secondary labels. Always paired with `dimColor`. */
  chrome: 'gray',
  /** Yellow — in-flight turn / context warning. */
  busy: 'yellow',
  /** Red — boot failure, permission deny, context near limit. */
  danger: 'red',
  /** Green — accepted state (e.g. active prompt cursor). */
  active: 'green',
  /** Magenta — the active-mode footer below the input. */
  mode: 'magenta',
} as const;

/** Shared border style used by InputBox, ListPicker, dialog panels. */
export const Border = {
  style: 'round' as const,
  color: Colors.chrome,
  dim: true,
} as const;

/**
 * True when the terminal/user has opted out of color (NO_COLOR convention, or
 * an explicit `MOXXY_NO_COLOR`). State signalled by hue alone is invisible
 * here (and to color-vision-deficient users), so callers pair every color
 * escalation with a non-color glyph/text cue when this is set — see
 * {@link contextMarker}.
 */
export function noColor(): boolean {
  return Boolean(process.env.NO_COLOR) || Boolean(process.env.MOXXY_NO_COLOR);
}

/** Context-meter color escalation. Used by HeaderBar `↑ <%>`. */
export function contextColor(pct: number): typeof Colors[keyof typeof Colors] | undefined {
  if (pct >= 85) return Colors.danger;
  if (pct >= 60) return Colors.busy;
  return undefined;
}

/**
 * Non-color cue for the context meter so the danger/warning state isn't
 * signalled by hue alone (color-vision deficiency, monochrome terminals,
 * NO_COLOR). Mirrors the {@link contextColor} thresholds: `⚠` at the danger
 * threshold, `!` at the warning threshold, empty string otherwise. Callers
 * append this next to the `<%>` readout.
 */
export function contextMarker(pct: number): string {
  if (pct >= 85) return ' ⚠';
  if (pct >= 60) return ' !';
  return '';
}

/**
 * Non-color marker prefix for a badged mode so an autonomous (e.g. goal) mode
 * is still distinguishable when the background hue is unavailable. `'» '` for
 * attention-tone modes, empty otherwise.
 */
export function badgeMarker(tone: 'attention' | 'info' | undefined): string {
  return tone === 'attention' ? '» ' : '';
}

/**
 * Background color for a persistent mode badge (reverse-video pill, black
 * text). `attention` — magenta — for autonomous modes the user must always
 * notice (e.g. goal mode); anything else falls back to gray chrome.
 */
export function badgeBackground(tone: 'attention' | 'info' | undefined): string {
  return tone === 'attention' ? Colors.mode : Colors.chrome;
}
