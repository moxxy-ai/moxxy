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

export const MOXXY_LOGO_COMPACT = 'MOXXY';

/** Render the moxxy banner. Falls back to a tighter form on narrow terminals. */
export function renderLogo(width: number = process.stdout.columns ?? 80): string {
  if (width < 40) return '\n' + colors.bold('MOXXY') + '\n\n';
  if (width < 60) return '\n' + colors.bold('M O X X Y') + '\n\n';
  return '\n' + LOGO_LINES.map((l) => colors.bold(l)).join('\n') + '\n\n';
}
