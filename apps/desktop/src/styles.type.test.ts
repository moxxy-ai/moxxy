import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * One voice for labels. The old frame set its labels in small tracked capitals,
 * like an instrument panel; the messenger look sets them in sentence case. A
 * view that keeps the capitals reads as a screen from another app, so the rule
 * is held for the stylesheet and for every inline style in the renderer.
 */
const SRC = __dirname;
// A Windows checkout (core.autocrlf) ends lines with \r\n.
const css = readFileSync(join(SRC, 'styles.css'), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}

describe('label type', () => {
  it('sets no label in capitals in the stylesheet', () => {
    // Raising a first letter is how a lower-case label gets its sentence case.
    const offenders = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, selector, body]) => /text-transform:\s*uppercase/.test(body ?? '') && !/::first-letter/.test(selector ?? ''))
      .map(([, selector]) => (selector ?? '').trim());
    expect(offenders).toEqual([]);
  });

  it('tracks no label out: wide letter-spacing only ever went with the capitals', () => {
    const wide = [...css.matchAll(/letter-spacing:\s*(0?\.\d+)em/g)]
      .map(([, value]) => Number(value))
      .filter((value) => value >= 0.04);
    expect(wide).toEqual([]);
  });

  it('sets no label in capitals from an inline style', () => {
    const offenders = sources(SRC)
      .filter((file) => /textTransform:\s*['"]uppercase['"]/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SRC.length + 1).split('\\').join('/'));
    expect(offenders).toEqual([]);
  });

  it('tracks no label out from an inline style either', () => {
    // Masked secrets are dots, not a label: their spacing is what makes them read as hidden.
    const offenders = sources(SRC)
      .filter((file) => !file.endsWith('VaultTab.tsx'))
      .filter((file) =>
        [...readFileSync(file, 'utf8').matchAll(/letterSpacing:\s*['"](0?\.\d+)em['"]/g)].some(
          ([, value]) => Number(value) >= 0.04,
        ),
      )
      .map((file) => file.slice(SRC.length + 1).split('\\').join('/'));
    expect(offenders).toEqual([]);
  });
});

describe('state chips', () => {
  const rule = (selector: string): string =>
    [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, selectors]) => (selectors ?? '').split(',').some((s) => s.trim() === selector))
      .map(([, , body]) => body ?? '')
      .join('\n');

  it('draws a state as a filled pill, not an outlined tag', () => {
    const tag = rule('.tag');
    expect(tag).toContain('border-radius: var(--radius-pill)');
    expect(tag).toContain('background: var(--color-input-soft)');
    expect(tag).not.toMatch(/border:\s*1px/);
  });

  it('colours a state by its tone, each on its own soft fill', () => {
    expect(rule(".tag[data-tone='good']")).toContain('background: var(--color-green-soft)');
    expect(rule(".tag[data-tone='bad']")).toContain('background: var(--color-red-soft)');
    expect(rule(".tag[data-tone='warn']")).toContain('background: var(--color-amber-soft)');
  });

  it('answers a press on a chip that is a switch', () => {
    expect(rule('.tag--press:active:not(:disabled)')).toMatch(/transform:\s*scale\(0\.9\d\)/);
  });
});
