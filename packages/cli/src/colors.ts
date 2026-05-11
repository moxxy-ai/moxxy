/**
 * Tiny zero-dep ANSI color helper. Respects:
 *   - NO_COLOR=1     (honored per https://no-color.org)
 *   - FORCE_COLOR=1  (forces on even when not a TTY)
 *   - stdout.isTTY   (auto-disabled when piped to a file/process)
 *
 * Each helper is a function `(s: string) => string` so call sites read
 * naturally: `colors.green('[ ok ]')` etc.
 */

function useColor(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout.isTTY);
}

const ENABLED = useColor();

function wrap(open: number, close: number): (s: string) => string {
  return (s: string) => (ENABLED ? `\x1b[${open}m${s}\x1b[${close}m` : s);
}

export const colors = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  italic: wrap(3, 23),
  underline: wrap(4, 24),

  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),

  /** Convenience: returns the same input untouched. Useful for conditional use. */
  none: (s: string) => s,
};

export const colorsEnabled = ENABLED;
