import { describe, expect, it } from 'vitest';
import { tokens, darkTokens, type ThemeTokens } from './index.js';

/**
 * A palette change is otherwise unverifiable by CI: nothing fails when colours
 * become unreadable, and "looks fine on my monitor" is not a check. Contrast
 * ratio IS objective, so these tests pin the one property of the palette that
 * can actually be wrong for a user rather than merely unfashionable.
 *
 * Thresholds are WCAG 2.1: 4.5:1 for body text, 3:1 for large text and for the
 * non-text boundary of a UI component (a button fill against the page it sits
 * on, a focus ring against its surroundings).
 */

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance per WCAG 2.1, for `#rrggbb` or `rgb(r, g, b)`. */
function luminance(color: string): number {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  let r: number;
  let g: number;
  let b: number;
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  } else {
    const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(color);
    if (!m) throw new Error(`cannot parse colour: ${color}`);
    [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
}

/** Pairings that must hold in BOTH themes, as [foreground, background, min]. */
function pairsFor(t: ThemeTokens): ReadonlyArray<readonly [string, string, string, number]> {
  return [
    ['body text on the app background', t.color.text, t.color.appBg, 4.5],
    ['body text on the main column', t.color.text, t.color.mainBg, 4.5],
    ['body text on a card', t.color.text, t.color.cardBg, 4.5],
    ['muted text on a card', t.color.textMuted, t.color.cardBg, 4.5],
    ['sidebar text on the sidebar', t.color.sidebarText, t.color.sidebarBg, 4.5],
    ['sidebar text on the active row', t.color.sidebarText, t.color.sidebarBgActive, 4.5],
    // Component boundaries: a filled control against the surface behind it.
    ['the primary fill against the app background', t.color.primary, t.color.appBg, 3],
    ['the primary fill against a card', t.color.primary, t.color.cardBg, 3],
    ['the send fill against the main column', t.color.send, t.color.mainBg, 3],
  ];
}

describe.each([
  ['light', tokens as ThemeTokens],
  ['dark', darkTokens],
])('%s palette contrast', (_name, theme) => {
  it.each(pairsFor(theme))('%s meets %s', (_label, fg, bg, min) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(min);
  });

  // The status hues are the ones a user must be able to tell apart AT A GLANCE
  // while something is going wrong, so they get the same floor as a control.
  it.each([
    ['red', 'red'],
    ['amber', 'amber'],
    ['green', 'green'],
  ] as const)('the %s status hue is distinguishable on a card', (_label, key) => {
    expect(contrast(theme.color[key], theme.color.cardBg)).toBeGreaterThanOrEqual(3);
  });

  // Dim text is deliberately quiet, but it still has to be readable; WCAG's
  // large-text floor is the honest bar for it rather than exempting it.
  it('dim text clears the large-text floor', () => {
    expect(contrast(theme.color.textDim, theme.color.cardBg)).toBeGreaterThanOrEqual(3);
  });
});

/**
 * The label on a commanded fill. This is the palette's one asymmetric decision:
 * light's accent is a deep mulberry that carries WHITE, dark's is luminous
 * magenta that carries INK, and `onPrimary` is what encodes the difference. A
 * call site that hard-codes `#fff` passes in light and silently fails in dark,
 * so the pairing is asserted per theme rather than assuming white.
 */
describe.each([
  ['light', tokens as ThemeTokens],
  ['dark', darkTokens],
])('%s: the label on a commanded fill', (_name, theme) => {
  it.each([
    ['primary', 'primary'],
    ['primaryStrong', 'primaryStrong'],
    ['send', 'send'],
    ['accent', 'accent'],
  ] as const)('onPrimary is readable on %s', (_label, key) => {
    expect(contrast(theme.color.onPrimary, theme.color[key])).toBeGreaterThanOrEqual(4.5);
  });
});
