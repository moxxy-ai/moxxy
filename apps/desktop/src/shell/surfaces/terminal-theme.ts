/**
 * The terminal's colours, read from the palette.
 *
 * xterm paints to a canvas and cannot resolve `var()`, so it is handed
 * concrete values. They come from the same tokens the work panel is drawn
 * with: the terminal sits on the panel's own background, and what a program
 * prints in colour stays readable in both themes.
 */

export interface TerminalTheme {
  readonly background: string;
  readonly foreground: string;
  readonly cursor: string;
  readonly cursorAccent: string;
  readonly selectionBackground: string;
  readonly black: string;
  readonly red: string;
  readonly green: string;
  readonly yellow: string;
  readonly blue: string;
  readonly magenta: string;
  readonly cyan: string;
  readonly white: string;
  readonly brightBlack: string;
  readonly brightRed: string;
  readonly brightGreen: string;
  readonly brightYellow: string;
  readonly brightBlue: string;
  readonly brightMagenta: string;
  readonly brightCyan: string;
  readonly brightWhite: string;
}

/** Which token each colour comes from, and what stands in before the stylesheet loads. */
const SOURCES: Readonly<Record<keyof TerminalTheme, readonly [token: string, fallback: string]>> = {
  background: ['--color-card-bg', '#212121'],
  foreground: ['--color-text', '#f5f5f5'],
  cursor: ['--color-primary', '#ff4a1e'],
  cursorAccent: ['--color-card-bg', '#212121'],
  selectionBackground: ['--color-primary-soft', '#3a1a10'],
  // "Black" is mostly a background a program sets, so it is a tint of the panel.
  black: ['--color-bubble-inset', '#2e2e2e'],
  red: ['--color-red-text', '#f2545b'],
  green: ['--color-green', '#3fb68b'],
  yellow: ['--color-amber-text', '#e8a33d'],
  blue: ['--color-reference', '#4fb3c8'],
  magenta: ['--color-primary', '#ff4a1e'],
  cyan: ['--color-reference', '#4fb3c8'],
  white: ['--color-text-muted', '#a6a6a6'],
  brightBlack: ['--color-text-dim', '#858585'],
  brightRed: ['--color-red-text', '#f2545b'],
  brightGreen: ['--color-green', '#3fb68b'],
  brightYellow: ['--color-amber-text', '#e8a33d'],
  brightBlue: ['--color-reference', '#4fb3c8'],
  brightMagenta: ['--color-primary', '#ff4a1e'],
  brightCyan: ['--color-reference', '#4fb3c8'],
  brightWhite: ['--color-text', '#f5f5f5'],
};

export function terminalTheme(readToken: (name: string) => string): TerminalTheme {
  const theme = {} as Record<keyof TerminalTheme, string>;
  for (const key of Object.keys(SOURCES) as Array<keyof TerminalTheme>) {
    const [token, fallback] = SOURCES[key];
    theme[key] = readToken(token).trim() || fallback;
  }
  return theme;
}
