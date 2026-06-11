import type { StepKindMeta } from '@moxxy/workflows-builder';

/**
 * Map the shared model's semantic accent names to concrete desktop colors.
 * The shared package stays platform-neutral (it only names a color); each UI
 * resolves the name to its own palette. Falls back to the brand pink.
 */
const ACCENT_HEX: Record<StepKindMeta['accent'], string> = {
  blue: '#3b82f6',
  green: '#10b981',
  purple: '#8b5cf6',
  teal: '#14b8a6',
  amber: '#f59e0b',
  pink: '#ec4899',
  cyan: '#06b6d4',
  orange: '#f97316',
};

export function accentHex(accent: StepKindMeta['accent']): string {
  return ACCENT_HEX[accent] ?? '#ec4899';
}

/** A translucent wash of the accent, for node card backgrounds. */
export function accentWash(accent: StepKindMeta['accent']): string {
  return `color-mix(in oklab, ${accentHex(accent)} 8%, var(--color-card-bg))`;
}
