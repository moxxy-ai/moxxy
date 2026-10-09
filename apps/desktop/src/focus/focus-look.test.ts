import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FOCUS_DARK_VARS, FOCUS_LIGHT_VARS, style } from './focus-styles';

const read = (path: string): string => readFileSync(resolve(__dirname, path), 'utf8');

/** `--name: value` pairs declared in a run of CSS text. */
function declarations(css: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of css.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name && value) found.set(name, value.trim());
  }
  return found;
}

/** The body of the first rule whose selector line is exactly `selector {`. */
function ruleBodies(css: string, selector: string): string {
  const bodies: string[] = [];
  let from = 0;
  for (;;) {
    const start = css.indexOf(`\n${selector} {`, from);
    if (start === -1) break;
    const end = css.indexOf('\n}', start);
    bodies.push(css.slice(start, end));
    from = end;
  }
  return bodies.join('\n');
}

function resolveAlias(vars: Map<string, string>, value: string): string {
  const alias = /^var\((--[\w-]+)\)$/.exec(value);
  if (!alias || !alias[1]) return value;
  const target = vars.get(alias[1]);
  return target === undefined ? value : resolveAlias(vars, target);
}

describe('the focus window wears the desktop palette', () => {
  const css = read('../styles.css');
  const light = declarations(ruleBodies(css, ':root'));
  const dark = new Map([...light, ...declarations(ruleBodies(css, '[data-theme="dark"]'))]);

  it.each([
    ['light', FOCUS_LIGHT_VARS, light],
    ['dark', FOCUS_DARK_VARS, dark],
  ] as const)('carries the same %s colours as styles.css', (_name, copy, desktop) => {
    const drift: string[] = [];
    for (const [name, value] of declarations(copy)) {
      if (!name.startsWith('--color-')) continue;
      const expected = desktop.get(name);
      if (expected === undefined) continue;
      const resolved = resolveAlias(desktop, expected);
      if (resolved.toLowerCase() !== value.toLowerCase()) drift.push(`${name}: focus ${value}, desktop ${resolved}`);
    }
    expect(drift).toEqual([]);
  });
});

describe('the Mini Chat panel is a card like the desktop ones', () => {
  it('is rounded and lifted off the screen behind it', () => {
    expect(style.panel.borderRadius).toBe('var(--radius-card)');
    expect(style.panel.boxShadow).toBe('var(--focus-panel-shadow)');
  });

  it('stands the composer on the panel, with no strip of its own', () => {
    expect(style.composerDock).not.toHaveProperty('borderTop');
    expect(style.composerDock).not.toHaveProperty('background');
  });

  it('draws no field, send or stop of its own', () => {
    expect(style).not.toHaveProperty('input');
    expect(style).not.toHaveProperty('send');
    expect(style).not.toHaveProperty('sendDisabled');
    expect(style).not.toHaveProperty('stop');
  });
});

describe('the focus document boots like the desktop', () => {
  it('loads the pieces the conversation needs', () => {
    const entry = read('focus-main.tsx');
    expect(entry).toContain('registerModeEvents()');
    expect(entry).toContain('<TipLayer />');
  });

  it('paints its first frame in the desktop face and neutral greys', () => {
    const html = read('../../focus.html');
    expect(html).not.toContain('IBM Plex Mono');
    expect(html).not.toMatch(/22, 24, 35|148, 163, 184|#e8eaf6|#e4ebef|#0b0f12/i);
  });
});
