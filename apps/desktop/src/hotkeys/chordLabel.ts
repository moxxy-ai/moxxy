import { formatChord, parseChord } from './chord';

/** Whether this machine's keyboard has Command where others have Control. */
export function isMacPlatform(): boolean {
  return navigator.platform.toLowerCase().includes('mac');
}

/** A chord as this machine's keyboard writes it: `⌘K` on a Mac, `Ctrl+K` elsewhere. */
export function chordLabel(spec: string): string {
  return formatChord(parseChord(spec), isMacPlatform());
}
