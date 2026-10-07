import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Motion rules, held as rules. How an interface moves is felt rather than seen,
 * so a regression here passes every other test and every screenshot: a keyword
 * easing reads as sluggish, an overshoot as a toy, a hover that fires on a tap
 * as a stuck highlight.
 */
// A Windows checkout (core.autocrlf) ends lines with \r\n.
const css = readFileSync(join(__dirname, 'styles.css'), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** The body of the first block whose header contains `header`, braces matched. */
function block(header: string): string {
  const at = css.indexOf(header);
  expect(at, `no block for ${header}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`unbalanced block for ${header}`);
}

describe('styles.css — easing', () => {
  it('declares the three curves every animation draws from', () => {
    const root = block(':root');
    expect(root).toContain('--ease-out: cubic-bezier(0.23, 1, 0.32, 1);');
    expect(root).toContain('--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);');
    expect(root).toContain('--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);');
  });

  it('never eases in: a slow start reads as an interface that is not listening', () => {
    expect(css).not.toMatch(/\bease-in\b(?!-out)/);
  });

  it('uses the curves, not the weak ease-out and ease-in-out keywords', () => {
    const withoutTokens = css.replace(/--ease-(out|in-out)\b/g, '');
    expect(withoutTokens).not.toMatch(/\bease-out\b/);
    // A breathing loop is the one place the gentle keyword is right: the strong
    // curve would turn a slow pulse into a snap.
    const offLoop = withoutTokens.split('\n').filter((line) => !line.includes('infinite'));
    expect(offLoop.join('\n')).not.toMatch(/\bease-in-out\b/);
  });

  it('never overshoots: no curve leaves the 0..1 range', () => {
    for (const [, args] of css.matchAll(/cubic-bezier\(([^)]*)\)/g)) {
      const [, y1, , y2] = (args ?? '').split(',').map(Number);
      expect(y1, `cubic-bezier(${args})`).toBeLessThanOrEqual(1);
      expect(y2, `cubic-bezier(${args})`).toBeLessThanOrEqual(1);
    }
  });

  it('names the properties it transitions', () => {
    expect(css).not.toMatch(/transition(-property)?:\s*all\b/);
  });
});

describe('styles.css — entrances and presses', () => {
  it('never grows an element out of nothing', () => {
    expect(css).not.toMatch(/scale\(0\)/);
    expect(block('@keyframes moxxy-pop-in')).not.toMatch(/scale\(1\.\d+\)/);
  });

  it('answers a press at once, on the strong curve', () => {
    expect(block('button:active:not(:disabled)')).toMatch(/transform:\s*scale\(0\.97\)/);
    expect(block('\nbutton {')).toMatch(/transform var\(--motion-press\) var\(--ease-out\)/);
  });

  it('only shows the universal hover to a pointer that can hover', () => {
    const hoverable = block('@media (hover: hover) and (pointer: fine)');
    expect(hoverable).toContain('button:hover:not(:disabled)');
  });
});

describe('styles.css — durations', () => {
  it('takes state changes from the motion tokens, not from literals', () => {
    for (const selector of ['.row-button {', '.skill-card {', '.btn-suggestion {']) {
      expect(block(`\n${selector}`), selector).not.toMatch(/\d+ms/);
    }
  });
});
