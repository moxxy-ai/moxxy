import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The conversation's drawing rules. Which side a bubble sits on and what the
 * composer is made of are CSS, so nothing else would notice them regress.
 */
// A Windows checkout (core.autocrlf) ends lines with \r\n.
const css = readFileSync(join(__dirname, 'styles.css'), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** The bodies of every rule whose selector list names `selector` exactly. */
function rulesFor(selector: string): string[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => (selectors ?? '').split(',').some((s) => s.trim() === selector))
    .map(([, , body]) => body ?? '');
}

function ruleFor(selector: string): string {
  const bodies = rulesFor(selector);
  expect(bodies.length, `no rule for ${selector}`).toBeGreaterThan(0);
  return bodies.join('\n');
}

describe('styles.css — the conversation', () => {
  it('has no timeline: no gutter, no glyphs', () => {
    expect(css).not.toMatch(/\.tr__(gutter|glyph)\b/);
  });

  it('puts the person on the right and the agent on the left', () => {
    expect(ruleFor(".tr[data-role='user']")).toMatch(/align-items:\s*flex-end/);
    expect(ruleFor('.tr')).toMatch(/align-items:\s*flex-start/);
  });

  it('fills the person’s bubble with the action colour and its paired label', () => {
    const bubble = ruleFor('.bubble--user');
    expect(bubble).toContain('background: var(--color-action)');
    expect(bubble).toContain('color: var(--color-on-action)');
  });

  it('fills the agent’s bubble with its own tone, in both themes', () => {
    expect(ruleFor('.bubble--agent')).toContain('background: var(--color-bubble)');
    expect(css.match(/--color-bubble:\s*#[0-9a-f]{6};/g)).toHaveLength(2);
  });

  it('keeps a reading measure for the transcript and the composer alike', () => {
    expect(ruleFor('.transcript__row')).toContain('max-width: var(--frame-measure)');
    expect(ruleFor('.cmdbar')).toContain('max-width: var(--frame-measure)');
  });

  it('reveals what is under a message by opacity alone, and only for a real pointer', () => {
    const foot = ruleFor('.tr__foot');
    expect(foot).toMatch(/opacity:\s*0/);
    expect(foot).toMatch(/transition:\s*opacity\b[^,;]*;/);
    // The hover rule lives inside a hover-capable media block, never bare.
    const bare = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    expect(bare).not.toMatch(/\.tr:hover/);
    expect(css).toMatch(/@media \(hover: none\)\s*\{\s*\.tr__foot\s*\{\s*opacity:\s*1/);
  });
});

describe('styles.css — the composer', () => {
  it('has no status strip and no hint line', () => {
    expect(css).not.toMatch(/\.cmdbar__(strip|hint|keys)\b/);
  });

  it('is a card that shows it has the keyboard', () => {
    expect(ruleFor('.cmdbar__card')).toContain('border-radius: var(--radius-bubble)');
    expect(ruleFor('.cmdbar__card:focus-within')).toContain('border-color: var(--color-primary)');
  });

  it('makes its buttons round and answers a press', () => {
    for (const selector of ['.composer-btn', '.composer-send']) {
      expect(ruleFor(selector), selector).toContain('border-radius: var(--radius-pill)');
    }
    expect(ruleFor('.composer-btn:active:not(:disabled)')).toMatch(/transform:\s*scale\(0\.9[4-8]\)/);
    expect(ruleFor('.composer-send:active:not(:disabled)')).toMatch(/transform:\s*scale\(0\.9[4-8]\)/);
  });

  it('drops the accent from Send when there is nothing to send', () => {
    const disabled = ruleFor('.composer-send:disabled');
    expect(disabled).toContain('background: var(--color-input-soft)');
    expect(disabled).not.toContain('--color-action');
  });
});
