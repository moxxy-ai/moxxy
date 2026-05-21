/**
 * Plain-string moxxy banner for non-Ink contexts (`moxxy --help`, init wizard
 * intro, doctor output). Reuses the shared `LOGO_LINES` from
 * `@moxxy/plugin-cli/logo-data` so the TUI's React `<Logo />` and this
 * helper stay in lock-step. The slogan + version line is rendered by the
 * caller (typically in the clack-style box header right under the banner),
 * not by this function — that keeps the slogan from appearing twice.
 */

import { LOGO_LINES } from '@moxxy/plugin-cli';
import { colors } from './colors.js';

export const MOXXY_LOGO_COMPACT = '|X|';

/** Render the moxxy banner. Falls back to a one-line mark on ultra-narrow terminals. */
export function renderLogo(width: number = process.stdout.columns ?? 80): string {
  // `gray` (ANSI 90 / bright-black) + `dim` (SGR 2). Both interpreted by
  // the terminal relative to its own palette, so the banner reads as
  // barely-visible chrome in both light and dark themes — never glaring,
  // never quite invisible.
  const fade = (s: string): string => colors.dim(colors.gray(s));
  if (width < 20) return '\n' + fade('|X|  moxxy') + '\n\n';
  return '\n' + LOGO_LINES.map(fade).join('\n') + '\n\n';
}
