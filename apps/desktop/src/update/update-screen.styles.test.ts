import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The installer screen is seen rarely and for a while, so how it moves is most
 * of what it is. The rules it must keep, read from the stylesheet (the shared
 * ones — curves, no layout animation — are held by `styles.motion.test.ts`).
 */
const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function rule(selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
}

describe('the installer screen', () => {
  it('sits on the chat surface, above everything else in the window', () => {
    const screen = rule('.update-screen');
    expect(screen).toContain('background: var(--color-main-bg)');
    expect(Number(/z-index:\s*(\d+)/.exec(screen)?.[1])).toBeGreaterThan(1210);
  });

  it('leaves faster than it arrives, and lets clicks through while it does', () => {
    expect(rule('.update-screen')).toMatch(/animation:[^;]*var\(--motion-overlay\) var\(--ease-out\)/);
    const leaving = rule(".update-screen[data-leaving='true']");
    expect(leaving).toMatch(/animation:[^;]*var\(--motion-shift\) var\(--ease-out\)/);
    expect(leaving).toContain('pointer-events: none');
  });

  it('enters from nearly full size, never from nothing', () => {
    expect(rule('.update-screen__panel')).toMatch(/animation:\s*moxxy-pop-in/);
  });

  it('brings the steps in one after another', () => {
    expect(rule('.update-step')).toMatch(/animation-delay:\s*calc\(var\(--i, 0\) \* \d+ms/);
  });

  it('fills the bar by scaling it, so nothing is laid out again', () => {
    const fill = rule('.update-progress__fill');
    expect(fill).toContain('transform-origin: left');
    expect(fill).toMatch(/transition:\s*transform var\(--motion-shift\)/);
  });

  it('changes a step\'s mark by fading and scaling, on the motion tokens', () => {
    const layer = rule('.update-step__glyph > *');
    expect(layer).toMatch(/transition:\s*opacity var\(--motion-shift\) var\(--ease-out\),\s*transform var\(--motion-shift\) var\(--ease-out\)/);
    expect(layer).toMatch(/transform:\s*scale\(0\.9\)/);
  });

  it('keeps the fades and drops the movement when less motion is asked for', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n  .update-screen__panel'));
    expect(reduced).toMatch(/\.update-screen__panel,\s*\.update-step\s*{\s*animation-name:\s*moxxy-fade-in/);
  });
});
