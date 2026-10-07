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

describe('voice-rail.css', () => {
  it('sits on the composer’s measure instead of running the width of the window', () => {
    const shell = rule('.voice-rail-shell');
    expect(shell).toMatch(/max-width:\s*calc\(var\(--frame-measure\)/);
    expect(shell).toMatch(/margin:\s*0 auto/);
  });

  it('is a card of the composer’s make, not a strip under a hairline', () => {
    const card = rule('.voice-rail');
    expect(card).toMatch(/border:\s*1px solid var\(--color-card-border-strong\)/);
    expect(card).toMatch(/border-radius:\s*var\(--radius-bubble\)/);
    expect(card).toMatch(/background:\s*var\(--color-surface\)/);
    expect(card).not.toMatch(/border-top:/);
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
