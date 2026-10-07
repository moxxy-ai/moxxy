import { formatChord, parseChord } from './chord';

/** A chord as this machine's keyboard writes it: `⌘K` on a Mac, `Ctrl+K` elsewhere. */
export function chordLabel(spec: string): string {
  const isMac = navigator.platform.toLowerCase().includes('mac');
  return formatChord(parseChord(spec), isMac);
}
