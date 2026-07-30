import type { StepKindMeta } from '@moxxy/workflows-builder';

/**
 * Map the shared model's semantic accent names to concrete desktop colours. The
 * shared package stays platform-neutral (it only names a colour); each UI
 * resolves the name against its own palette.
 *
 * These stay a CATEGORICAL set — a workflow step kind is identified by its hue,
 * so they must remain mutually distinguishable rather than collapse into the
 * single accent. But they are resolved through the PALETTE's tokens wherever a
 * token exists, so a step kind and a status LED of the same colour actually are
 * the same colour, and both re-theme with everything else. They were raw Tailwind
 * hexes, which is why the workflow canvas read as a different application.
 *
 * The four with no token (blue, teal, cyan, orange) are given values in the
 * panel's own blue-green-biased family rather than borrowed from a framework.
 * They are theme-invariant on purpose: a categorical hue that changed between
 * light and dark would stop identifying the same kind.
 */
const ACCENT_COLOR: Record<StepKindMeta['accent'], string> = {
  blue: '#5b8dd6',
  green: 'var(--color-green)',
  purple: 'var(--color-purple)',
  teal: '#3fa89c',
  amber: 'var(--color-amber)',
  pink: 'var(--color-primary)',
  cyan: 'var(--color-reference)',
  orange: '#d1793f',
};

/** Resolve a step-kind accent. Returns a CSS colour VALUE — usually a token
 *  reference — so call sites must use it in `style`, never in an SVG paint
 *  attribute (a presentation attribute does not resolve `var()`). */
export function accentHex(accent: StepKindMeta['accent']): string {
  return ACCENT_COLOR[accent] ?? 'var(--color-primary)';
}
