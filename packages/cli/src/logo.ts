/**
 * Plain-ASCII logo for moxxy. Two variants: a full block-letter banner shown
 * on TUI boot + help, and a single-line compact form for narrow terminals.
 *
 * Each line is a separate string to avoid template-literal escaping
 * gymnastics; chars are 7-bit ASCII so it renders everywhere.
 */

import { colors } from './colors.js';

const LOGO_LINES: ReadonlyArray<string> = [
  '  _ __ ___   _____  ___  ___ _   _ ',
  " | '_ ` _ \\ / _ \\ \\/ / |/ / | | |",
  ' | | | | | | (_) >  <|   <| |_| |',
  ' |_| |_| |_|\\___/_/\\_\\_|\\_\\\\__, |',
  '                              |___/ ',
];

export function renderLogoColored(): string {
  return (
    '\n' +
    LOGO_LINES.map((l) => colors.cyan(l)).join('\n') +
    '\n\n' +
    colors.dim(' block-based agentic loop') +
    '\n\n'
  );
}

export const MOXXY_LOGO_COMPACT = 'moxxy — block-based agentic loop';

/** Render the logo, falling back to the compact form when stdout is narrow. */
export function renderLogo(width: number = process.stdout.columns ?? 80): string {
  if (width < 40) return colors.cyan(MOXXY_LOGO_COMPACT) + '\n';
  return renderLogoColored();
}
