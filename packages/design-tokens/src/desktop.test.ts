import { describe, expect, it } from 'vitest';
import { tokens, darkTokens, type ThemeTokens } from './index.js';
import { desktopTokens, desktopDarkTokens } from './desktop.js';
import { generateThemeCss } from './css-vars.js';

/** The surfaces, seams and inks that make up the chrome — everything that is
 *  not a brand or status hue. */
const CHROME_KEYS = [
  'appBg',
  'mainBg',
  'surface',
  'inputSoft',
  'cardBg',
  'cardBorder',
  'cardBorderStrong',
  'text',
  'textMuted',
  'textDim',
  'sidebarBg',
  'sidebarBgHover',
  'sidebarBgActive',
  'sidebarText',
  'sidebarTextDim',
  'sidebarBorder',
] as const;

function channels(hex: string): readonly [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  return [parseInt(m[1] ?? '', 16), parseInt(m[2] ?? '', 16), parseInt(m[3] ?? '', 16)];
}

function leafPaths(node: object, prefix = ''): string[] {
  return Object.entries(node).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value !== null && typeof value === 'object' ? leafPaths(value, path) : [path];
  });
}

const PALETTES: ReadonlyArray<readonly [string, ThemeTokens, ThemeTokens]> = [
  ['light', desktopTokens, tokens],
  ['dark', desktopDarkTokens, darkTokens],
];

describe.each(PALETTES)('desktop %s palette', (_name, desktop, shared) => {
  it('keeps the shared token shape, so every existing CSS var still resolves', () => {
    expect(leafPaths(desktop)).toEqual(leafPaths(shared));
  });

  it.each(CHROME_KEYS)('%s is a neutral grey (no hue in the chrome)', (key) => {
    const [r, g, b] = channels(desktop.color[key]);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it('keeps the brand accent the shared palette uses', () => {
    expect(desktop.color.primary).toBe(shared.color.primary);
    expect(desktop.color.accent).toBe(shared.color.accent);
    expect(desktop.color.send).toBe(shared.color.send);
  });

  it('sets the chrome in a proportional face, shared with prose', () => {
    expect(desktop.font.chrome).not.toMatch(/mono/i);
    expect(desktop.font.chrome.endsWith('sans-serif')).toBe(true);
    expect(desktop.font.prose).toBe(desktop.font.chrome);
    expect(desktop.font.mono.endsWith('monospace')).toBe(true);
  });

  it('rounds its geometry, one step per level of nesting', () => {
    const { tag, chip, block, card } = desktop.radius;
    expect(tag).toBeLessThan(chip);
    expect(chip).toBeLessThan(block);
    expect(block).toBeLessThan(card);
    expect(chip).toBeGreaterThanOrEqual(6);
    expect(card).toBeGreaterThanOrEqual(12);
  });

  it('never drops chrome text below 11px', () => {
    for (const size of Object.values(desktop.type)) expect(size).toBeGreaterThanOrEqual(11);
  });
});

describe('desktop palettes leave the shared (mobile) palettes alone', () => {
  it('is a separate object from the shared tokens', () => {
    expect(desktopTokens).not.toBe(tokens);
    expect(desktopDarkTokens).not.toBe(darkTokens);
    expect(tokens.font.chrome).toMatch(/mono/i);
    expect(tokens.radius.card).toBe(6);
  });
});

describe('generateThemeCss for the desktop palettes', () => {
  const css = generateThemeCss(desktopTokens, desktopDarkTokens);
  const [light, dark] = css.split('[data-theme="dark"]');

  it('projects the light palette to :root', () => {
    expect(light).toContain(`  --color-app-bg: ${desktopTokens.color.appBg};`);
    expect(light).toContain(`  --font-chrome: ${desktopTokens.font.chrome};`);
    expect(light).toContain(`  --radius-card: ${desktopTokens.radius.card}px;`);
  });

  it('projects only the colours to the dark block', () => {
    expect(dark).toContain(`  --color-app-bg: ${desktopDarkTokens.color.appBg};`);
    expect(dark).not.toContain('--font-chrome');
    expect(dark).not.toContain('--radius-card');
  });
});
