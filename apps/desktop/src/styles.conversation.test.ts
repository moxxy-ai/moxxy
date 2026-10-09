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

describe('styles.css — what the next turn will do, above the field', () => {
  it('says it as a dot and a line of text, the way a run says its state, not as a filled capsule', () => {
    const status = ruleFor('.status-chip');
    expect(status).not.toMatch(/background/);
    expect(status).not.toMatch(/border-radius/);
    expect(status).not.toMatch(/padding/);
    expect(status).toMatch(/font-size:\s*var\(--type-label\)/);
    const dot = ruleFor('.status-chip::before');
    expect(dot).toMatch(/width:\s*6px/);
    expect(dot).toMatch(/border-radius:\s*50%/);
  });

  it('carries the tone in the dot: amber for a caution, the accent for a mode', () => {
    expect(ruleFor(".status-chip[data-tone='warn']::before")).toMatch(/background:\s*var\(--color-amber\)/);
    expect(ruleFor(".status-chip[data-tone='accent']::before")).toMatch(/background:\s*var\(--color-primary\)/);
    for (const tone of ['warn', 'accent']) {
      expect(rulesFor(`.status-chip[data-tone='${tone}']`).join('\n')).not.toMatch(/background/);
    }
  });
});

describe('styles.css — a round control that is on', () => {
  it('draws a running voice conversation as the header draws it: the accent on its soft ground', () => {
    const live = ruleFor(".composer-btn[data-tone='live']");
    expect(live).toContain('color: var(--color-primary-strong)');
    expect(live).toContain('background: var(--color-primary-soft)');
    expect(ruleFor(".btn-quiet[data-tone='live']")).toContain('background: var(--color-primary-soft)');
  });
});

describe('styles.css — the work panel', () => {
  it('takes no room and draws no strip while closed', () => {
    const closed = ruleFor('.bench--closed');
    expect(closed).toMatch(/width:\s*0\b/);
    // Parked inside it, the browser has to keep painting.
    expect(closed).not.toMatch(/display:\s*none/);
    expect(css).not.toMatch(/\.bench__(stub|count)\b/);
  });

  it('never animates its width, which the terminal measures at mount', () => {
    for (const body of [...rulesFor('.bench'), ...rulesFor('.bench:not(.bench--closed)')]) {
      expect(body).not.toMatch(/transition/);
    }
  });

  it('marks the open pane with a fill, not an underline', () => {
    expect(ruleFor(".bench__tab[data-active='true']")).toContain('background: var(--color-input-soft)');
    expect(css).not.toMatch(/\.bench__tab\[data-active='true'\]::after/);
  });
});

describe('styles.css — the conversation in a small window', () => {
  it('gives up the row gutter and lets a bubble use the width in the Mini Chat', () => {
    expect(ruleFor('.focus-transcript .transcript__row')).toMatch(/padding:\s*0 var\(--space-2\)/);
    expect(ruleFor('.focus-transcript .bubble--user')).toContain('max-width: 92%');
  });
});

describe('styles.css — a plan, a goal run and a research run', () => {
  it('draws what closes a mode as a bordered card on the bubble’s measure', () => {
    const card = ruleFor('.outcome');
    expect(card).toMatch(/border:\s*1px solid var\(--color-card-border\)/);
    expect(card).toMatch(/border-radius:\s*var\(--radius-bubble\)/);
    expect(card).toMatch(/max-width:\s*min\(100%, 640px\)/);
    expect(ruleFor('.outcome__body')).toMatch(/font-size:\s*var\(--type-prose\)/);
  });

  it('tints the card’s mark by how the work ended', () => {
    expect(ruleFor(".outcome[data-tone='good'] .outcome__mark")).toMatch(/background:\s*var\(--color-green-soft\)/);
    expect(ruleFor(".outcome[data-tone='warn'] .outcome__mark")).toMatch(/background:\s*var\(--color-amber-soft\)/);
  });

  it('keeps a step of the run a quiet line with a toned dot', () => {
    const note = ruleFor('.mode-note');
    expect(note).toMatch(/font-size:\s*var\(--type-label\)/);
    expect(note).toMatch(/color:\s*var\(--color-text-dim\)/);
    expect(ruleFor(".mode-note[data-tone='warn'] .mode-note__dot")).toMatch(/background:\s*var\(--color-amber\)/);
    expect(ruleFor(".mode-note[data-tone='good'] .mode-note__dot")).toMatch(/background:\s*var\(--color-green\)/);
  });

  it('lists the agents of a fan-out in the conversation’s own face', () => {
    const head = ruleFor('.agent-row__head');
    expect(head).toMatch(/font-size:\s*var\(--type-row\)/);
    expect(head).not.toMatch(/font-family/);
    expect(ruleFor('.agent-row__name')).toMatch(/text-overflow:\s*ellipsis/);
    expect(ruleFor(".agent-row__state[data-tone='failed']")).toMatch(/color:\s*var\(--color-red-text\)/);
  });
});

describe('styles.css — copying a block of a message', () => {
  it('carries the block’s rhythm and anchors the control in its corner', () => {
    const block = ruleFor('.md-block');
    expect(block).toMatch(/position:\s*relative/);
    expect(block).toMatch(/margin:\s*0 0 0\.7em/);
    const control = ruleFor('.md-block__copy');
    expect(control).toMatch(/position:\s*absolute/);
    expect(control).toMatch(/opacity:\s*0/);
  });

  it('reveals the control by opacity alone: for a real pointer, for the keyboard, and always on touch', () => {
    const control = ruleFor('.md-block__copy');
    expect(control).toMatch(/transition:\s*opacity[^;]*,\s*transform[^;]*;/);
    expect(css).toMatch(/@media \(hover: hover\) and \(pointer: fine\)\s*\{[^}]*\.md-block:hover > \.md-block__copy\s*\{\s*opacity:\s*1/);
    expect(ruleFor('.md-block__copy:focus-visible')).toMatch(/opacity:\s*1/);
    expect(ruleFor(".md-block__copy[data-copied='true']")).toMatch(/opacity:\s*1/);
    expect(css).toMatch(/@media \(hover: none\)\s*\{[^}]*\.md-block__copy\s*\{\s*opacity:\s*1/);
  });

  it('answers a press', () => {
    expect(ruleFor('.md-block__copy:active')).toMatch(/transform:\s*scale\(0\.9\d?\)/);
  });
});

describe('styles.css — a question that blocks the run', () => {
  it('is a card on the composer’s measure, not a strip across the window', () => {
    const dock = ruleFor('.ask-dock');
    expect(dock).toMatch(/max-width:\s*calc\(var\(--frame-measure\)/);
    // The same card as the composer under it, so the two read as a pair.
    expect(dock).toMatch(/border-radius:\s*var\(--radius-bubble\)/);
    expect(dock).toMatch(/background:\s*var\(--color-surface\)/);
    expect(dock).not.toMatch(/border-top:/);
  });

  it('titles it in the text colour and marks the kind with a small toned badge', () => {
    expect(ruleFor('.ask-dock__title')).toMatch(/color:\s*var\(--color-text\)/);
    expect(ruleFor(".ask-dock[data-tone='caution'] .ask-dock__mark")).toMatch(/background:\s*var\(--color-amber-soft\)/);
    expect(ruleFor('.ask-dock__mark')).toMatch(/background:\s*var\(--color-primary-soft\)/);
  });

  it('draws its answers as pills that answer a press', () => {
    const button = ruleFor('.ask-btn');
    expect(button).toMatch(/border-radius:\s*var\(--radius-pill\)/);
    expect(ruleFor('.ask-btn:active:not(:disabled)')).toMatch(/transform:\s*scale\(0\.97\)/);
    const primary = ruleFor(".ask-btn[data-tone='primary']");
    expect(primary).toMatch(/background:\s*var\(--color-action\)/);
    expect(primary).toMatch(/color:\s*var\(--color-on-action\)/);
    expect(ruleFor(".ask-btn[data-tone='danger']")).toMatch(/color:\s*var\(--color-red-text\)/);
  });

  it('shows a long call in a well that scrolls, so the answers stay in reach', () => {
    const well = ruleFor('.ask-dock__cmd');
    expect(well).toMatch(/max-height:\s*220px/);
    expect(well).toMatch(/overflow:\s*auto/);
    expect(well).toMatch(/white-space:\s*pre\b/);
  });

  it('keeps the same card in the focus window, in a smaller frame', () => {
    const toast = ruleFor('.ask-dock--toast');
    expect(toast).toMatch(/width:\s*468px/);
    expect(toast).toMatch(/max-height:\s*196px/);
    expect(ruleFor('.ask-dock--panel')).toMatch(/width:\s*100%/);
  });
});

