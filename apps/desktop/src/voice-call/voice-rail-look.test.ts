import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A voice conversation is the same conversation with a microphone open, so
 * its bar is made like the things around it: a card on the composer's
 * measure, round controls, a pill to end it, labels in sentence case.
 */

// A Windows checkout (core.autocrlf) ends lines with \r\n.
const css = readFileSync(join(__dirname, 'voice-rail.css'), 'utf8')
  .replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** The first rule for `selector`, outside any container query. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  expect(match, `no rule for ${selector}`).not.toBeNull();
  return match ? (match[2] ?? '') : '';
}

/** The states in which the capsule is the whole card. */
const OPEN = ".voice-rail:is(:hover, :has(:focus-visible), [data-open='true'])";

describe('voice-rail.css as a capsule', () => {
  it('rests as a capsule cut out of the card, around its state', () => {
    expect(rule('.voice-rail')).toMatch(/--voice-cut-x:\s*calc\(50% - var\(--voice-capsule\) \/ 2\)/);
    expect(rule('.voice-rail::before')).toMatch(/clip-path:\s*inset\(var\(--voice-cut-y\) var\(--voice-cut-x\) round/);
    // What is on the card is cut with it, a hair inside its edge.
    expect(rule('.voice-rail-body')).toMatch(
      /clip-path:\s*inset\(calc\(var\(--voice-cut-y\) \+ 1px\) calc\(var\(--voice-cut-x\) \+ 1px\) round/,
    );
  });

  it('opens under the pointer, under the keyboard, and when it is told to', () => {
    const open = rule(OPEN);
    expect(open).toMatch(/--voice-cut-x:\s*0px/);
    expect(open).toMatch(/--voice-cut-y:\s*0px/);
  });

  it('lets a click through everywhere the capsule is not', () => {
    // Only what is left of the cut takes the pointer; a cut-away control is reached by Tab.
    expect(rule('.voice-rail-shell')).toMatch(/pointer-events:\s*none/);
    expect(rule('.voice-rail::before')).toMatch(/pointer-events:\s*auto/);
    expect(rule('.voice-rail-body')).toMatch(/pointer-events:\s*auto/);
  });

  it('waits a moment before it closes, and none before it opens', () => {
    expect(rule('.voice-rail')).toMatch(/--voice-linger:\s*160ms/);
    expect(rule(OPEN)).toMatch(/--voice-linger:\s*0ms/);
  });

  it('moves only what the compositor can carry: never a width, a height or a margin', () => {
    const moved = [...css.matchAll(/transition:\s*([^;]+);/g)].map((match) => match[1] ?? '');
    expect(moved.join(' ')).not.toMatch(/\b(?:all|width|height|max-width|margin|padding|inset|left|right)\b/);
    expect(rule('.voice-rail::before')).toMatch(/transition:\s*clip-path/);
  });

  it('is the whole card where there is no pointer to open it, and where it is narrow', () => {
    expect(css).toMatch(/@media \(hover: none\)\s*\{[\s\S]*?--voice-cut-x:\s*0px/);
    expect(css).toMatch(/@container voice-rail \(max-width: 520px\)[\s\S]*?--voice-cut-x:\s*0px/);
  });

  it('does not move for someone who asked for less motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.voice-rail::before,[\s\S]*?transition:\s*none/);
  });
});

describe('voice-rail.css', () => {
  it('sits on the composer’s measure instead of running the width of the window', () => {
    const shell = rule('.voice-rail-shell');
    expect(shell).toMatch(/max-width:\s*calc\(var\(--frame-measure\)/);
    expect(shell).toMatch(/margin:\s*0 auto/);
  });

  it('is a card of the composer’s make, not a strip under a hairline', () => {
    // Its edge is a plate a hair wider than its face, so the card keeps an edge while it is cut to a capsule.
    expect(rule('.voice-rail::before')).toMatch(/var\(--color-card-border-strong\)/);
    expect(rule('.voice-rail-body')).toMatch(/background:\s*var\(--color-surface\)/);
    expect(rule(OPEN)).toMatch(/--voice-round:\s*var\(--radius-bubble\)/);
    expect(rule('.voice-rail')).not.toMatch(/border-top:/);
  });

  it('draws its controls round and its way out as a pill, and answers a press', () => {
    const control = rule('.voice-rail-control');
    expect(control).toMatch(/border-radius:\s*var\(--radius-pill\)/);
    expect(control).toMatch(/width:\s*32px/);
    expect(rule('.voice-rail-end')).toMatch(/border-radius:\s*var\(--radius-pill\)/);
    expect(rule('.voice-rail-action')).toMatch(/border-radius:\s*var\(--radius-pill\)/);
    expect(rule('.voice-rail-control:active')).toMatch(/transform:\s*scale\(0\.94\)/);
    expect(rule('.voice-rail-end:active')).toMatch(/transform:\s*scale\(0\.97\)/);
  });

  it('sets nothing in capitals or tracked out, and divides nothing with hairlines', () => {
    expect(css).not.toMatch(/text-transform:\s*uppercase/);
    expect(css).not.toMatch(/letter-spacing/);
    expect(rule('.voice-rail-work')).not.toMatch(/border-left/);
    expect(rule('.voice-rail-controls')).not.toMatch(/border-left/);
  });
});

describe('voice-rail.css for the reason a call stopped', () => {
  it('gives the reason two lines before it cuts it', () => {
    const reason = rule('.voice-rail-reason');

    expect(reason).toMatch(/-webkit-line-clamp:\s*2/);
    expect(reason).not.toMatch(/white-space:\s*nowrap/);
  });

  it('keeps the reason at every width: it is not supporting copy', () => {
    expect(css).not.toMatch(/\.voice-rail-reason\s*\{[^}]*display:\s*none/);
  });
});
