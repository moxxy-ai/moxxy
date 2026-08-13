/**
 * Shared moxxy logo data — consumed by the TUI's React `<Logo />` component
 * AND by the CLI's plain-string `renderLogo()` helper, so help screens,
 * the init wizard banner, and the TUI mount all show the same banner +
 * slogan during a single process.
 */

/**
 * The moxxy mark as grayscale ASCII art: the interlaced weave, sampled to a
 * character ramp. Drawn dim-gray everywhere it appears (boot screen, TUI
 * header, `--help`/`--version`, init wizard) so the banner reads as quiet
 * chrome in any terminal theme.
 *
 * Rows are stored right-trimmed; `LOGO_LINES` pads every row to the widest one
 * (`LOGO_WIDTH`) so per-row centering keeps the columns aligned. The art needs
 * a wide terminal to look right, see `LOGO_MIN_WIDTH` and `selectLogo`, which
 * fall back to the `MOXXY` wordmark on narrow ones.
 */
const LOGO_ART_RAW: ReadonlyArray<string> = [
  '                       -#@@@@',
  '                     -%@@@@@@',
  '             :*%@@+=%@@@@@+%@@@@@@@@@@%*:',
  '            +@@@+=%@@@@@++@@@@@@@@@@#+@@@+',
  '            @@%=%@@@@@= :---------:*@%=+@@',
  '            @@@@*::::              +@@@%=+',
  '            @@@@*                  -@@@@@%-',
  '            @@@@*                    =@@@@@%-',
  '        =+++@@@@*                    ++=@@@@@*',
  '       .@@@@%+@@*                    *@@+%@@@@.',
  '        *@@@@@=++                    *@@@@+++=',
  '         -%@@@@@=                    *@@@@',
  '           -%@@@@@-                  *@@@@',
  '            +=%@@@+              ::::*@@@@',
  '            @@+=%@*:---------: =@@@@@%=%@@',
  '            +@@@+#@@@@@@@@@@++@@@@@%=+@@@+',
  '             :*%@@@@@@@@@@%+@@@@@%=+@@%*:',
  '                         @@@@@@%-',
  '                         @@@@#-',
];

/** Widest mark row; every `LOGO_LINES` row is padded to this. */
export const LOGO_WIDTH = LOGO_ART_RAW.reduce((m, l) => Math.max(m, l.length), 0);

/**
 * The mark, every row padded to `LOGO_WIDTH`. Equal-width rows mean a
 * per-row center pad shifts the whole picture as one block instead of
 * ragged-centering each line and shearing the art.
 */
export const LOGO_LINES: ReadonlyArray<string> = LOGO_ART_RAW.map((l) => l.padEnd(LOGO_WIDTH));

/**
 * A half-height rendition of the same interlaced mark for the TUI boot screen.
 * It keeps the recognizable weave without spending most of a normal terminal
 * viewport on branding. Unlike the wordmark fallback, this is still the moxxy
 * mark users see in the full banner.
 */
const COMPACT_LOGO_ART_RAW: ReadonlyArray<string> = [
  '             -%@@@@',
  '      :*%@@+=%@@@+%@@@@@@@%*:',
  '      @@%=%@@@= :-------:*@%=@@',
  '      @@@@*              +@@@@%+',
  '   =++@@@@*              ++=@@@@*',
  '    *@@@@=+              *@@@@++=',
  '     -%@@@@-             *@@@@',
  '      @@+=%*:-------: =@@@%=%@@',
  '       :*%@@@@@@@%+@@@@%=+@@%*:',
  '              @@@@@@%-',
];

/** Widest compact-mark row; rows are padded so the weave never shears. */
export const COMPACT_LOGO_WIDTH = COMPACT_LOGO_ART_RAW.reduce(
  (max, line) => Math.max(max, line.length),
  0,
);

/** Compact moxxy mark used only by the transient TUI boot/empty state. */
export const COMPACT_LOGO_LINES: ReadonlyArray<string> = COMPACT_LOGO_ART_RAW.map((line) =>
  line.padEnd(COMPACT_LOGO_WIDTH),
);

/**
 * Block-letter `MOXXY` wordmark shown when the terminal is too narrow for the
 * mark (see `selectLogo`). Stored right-trimmed; `WORDMARK_LINES` pads to
 * `WORDMARK_WIDTH`.
 */
const WORDMARK_RAW: ReadonlyArray<string> = [
  'M   M   OOO   X   X  X   X  Y   Y',
  'MM MM  O   O   X X    X X    Y Y',
  'M M M  O   O    X      X      Y',
  'M   M  O   O   X X    X X     Y',
  'M   M   OOO   X   X  X   X    Y',
];

/** Widest wordmark row; every `WORDMARK_LINES` row is padded to this. */
export const WORDMARK_WIDTH = WORDMARK_RAW.reduce((m, l) => Math.max(m, l.length), 0);

/** The `MOXXY` wordmark, every row padded to `WORDMARK_WIDTH`. */
export const WORDMARK_LINES: ReadonlyArray<string> = WORDMARK_RAW.map((l) =>
  l.padEnd(WORDMARK_WIDTH),
);

/** Below this terminal width the mark is dropped for the `MOXXY` wordmark. */
export const LOGO_MIN_WIDTH = 80;
/** Below this terminal width the wordmark is dropped for a one-line text mark. */
export const WORDMARK_MIN_WIDTH = 40;

export interface LogoSelection {
  /** Which rendition fits: the full mark, the `MOXXY` wordmark, or plain text. */
  readonly kind: 'art' | 'wordmark' | 'text';
  /** Equal-width rows to render (a single row for `text`). */
  readonly lines: ReadonlyArray<string>;
}

/**
 * Pick the widest moxxy mark that fits `width`. The art only looks right on
 * a wide terminal, so narrower ones step down to the `MOXXY` wordmark, then to
 * a one-line `moxxy` text mark. Shared by the TUI components and the CLI's
 * plain-string `renderLogo()` so every surface steps down identically.
 */
export function selectLogo(width: number): LogoSelection {
  if (width >= LOGO_MIN_WIDTH) return { kind: 'art', lines: LOGO_LINES };
  if (width >= WORDMARK_MIN_WIDTH) return { kind: 'wordmark', lines: WORDMARK_LINES };
  return { kind: 'text', lines: ['moxxy'] };
}

/**
 * Catalog of rotating slogans. Pick one per process so `moxxy --help` and
 * the TUI mount stay consistent during the same invocation. Aim for ≤60
 * chars and a mild attitude.
 */
export const SLOGANS: ReadonlyArray<string> = [
  'your local agent, ready for this project',
  'connect a model. open a project. start.',
  'local by default, extensible by design',
  'use first. extend when needed.',
  'your model, your workspace, your approval',
  'simple to start. ready to govern.',
  'software work with the actions in view',
  'one local agent, from first task to policy',
];

let cachedSlogan: string | null = null;
/**
 * Returns a single slogan, cached for the lifetime of the process so every
 * caller in the same `moxxy` invocation sees the same line.
 */
export function pickSlogan(): string {
  if (cachedSlogan !== null) return cachedSlogan;
  cachedSlogan = SLOGANS[Math.floor(Math.random() * SLOGANS.length)]!;
  return cachedSlogan;
}

/**
 * Core-only example prompts surfaced on the first screen. Every suggestion
 * must work in a plain developer-alpha install; optional extensions are
 * discovered after the first useful run, never advertised before it.
 */
export const EXAMPLES: ReadonlyArray<string> = [
  'explain how this codebase fits together',
  'find where authentication is implemented',
  'review my uncommitted changes',
  'fix the failing tests in src/',
];

let cachedExamples: ReadonlyArray<string> | null = null;
/**
 * Returns `n` distinct example prompts (default 2), cached for the
 * lifetime of the process so re-renders never shuffle what the user
 * already saw. Subsequent calls return the SAME picks even with
 * different `n` — the first call wins. That keeps the boot-screen
 * suggestion list stable across React re-renders.
 */
export function pickExamples(n: number = 2): ReadonlyArray<string> {
  if (cachedExamples !== null) return cachedExamples;
  const pool = [...EXAMPLES];
  const out: string[] = [];
  for (let i = 0; i < n && pool.length > 0; i += 1) {
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool[idx]!);
    pool.splice(idx, 1);
  }
  cachedExamples = out;
  return cachedExamples;
}
