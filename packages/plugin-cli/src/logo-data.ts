/**
 * Shared moxxy logo data — consumed by the TUI's React `<Logo />` component
 * AND by the CLI's plain-string `renderLogo()` helper, so help screens,
 * the init wizard banner, and the TUI mount all show the same banner +
 * slogan during a single process.
 */

/**
 * Bold block-letter MOXXY banner, drawn with U+2588 / U+2554 style box
 * characters so it renders the same in every terminal that supports the
 * box-drawing range (every modern one). Widths add up to ~52 columns —
 * callers should switch to a compact form when the terminal is narrower.
 */
export const LOGO_LINES: ReadonlyArray<string> = [
  '███╗   ███╗  ██████╗  ██╗  ██╗ ██╗  ██╗ ██╗   ██╗',
  '████╗ ████║ ██╔═══██╗ ╚██╗██╔╝ ╚██╗██╔╝ ╚██╗ ██╔╝',
  '██╔████╔██║ ██║   ██║  ╚███╔╝   ╚███╔╝   ╚████╔╝ ',
  '██║╚██╔╝██║ ██║   ██║  ██╔██╗   ██╔██╗    ╚██╔╝  ',
  '██║ ╚═╝ ██║ ╚██████╔╝ ██╔╝ ██╗ ██╔╝ ██╗    ██║   ',
  '╚═╝     ╚═╝  ╚═════╝  ╚═╝  ╚═╝ ╚═╝  ╚═╝    ╚═╝   ',
];

/**
 * Catalog of rotating slogans. Pick one per process so `moxxy --help` and
 * the TUI mount stay consistent during the same invocation. Aim for ≤60
 * chars and a mild attitude.
 */
export const SLOGANS: ReadonlyArray<string> = [
  'block-by-block agentic loops',
  'every block swappable, every skill replicable',
  'skills that breed skills, plugins that hot-load',
  'the framework that builds itself',
  'loops. tools. skills. all yours.',
  'agents, assembled from interchangeable parts',
  'an event log, a loop, and a lot of plugins',
  'your agent stack, with the cover off',
  'self-improving by design, paranoid by default',
  'open-loop architecture for closed-loop agents',
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
