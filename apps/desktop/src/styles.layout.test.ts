import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Layout rules jsdom cannot measure, held as rules. Each one was a fault in the
 * packaged app: an invisible tooltip bubble widened the session list, so
 * anything that scrolled a row into view (focus, a click) slid the whole
 * sidebar left and cut "RUNS" to "UNS".
 */
// A Windows checkout (core.autocrlf) ends lines with \r\n.
const css = readFileSync(join(__dirname, 'styles.css'), 'utf8').replace(/\r\n/g, '\n');

/** The declarations of the rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
  const at = css.search(new RegExp(`(^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`, 'm'));
  expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', at + 1);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('styles.css — what the eye does not see takes no room', () => {
  it('draws the tooltip over the window, not inside its control', () => {
    // A bubble that lived inside the control took room beside it and was cut by
    // every panel that clips: the sidebar, the composer card, a scrolling list.
    expect(css).not.toMatch(/\.tip[^{]*::after/);
    const bubble = rule('.tip-bubble');
    expect(bubble).toMatch(/position:\s*fixed/);
    expect(bubble).toMatch(/pointer-events:\s*none/);
    // Above the modals (1100): a control inside one has a tooltip too.
    expect(Number(/z-index:\s*(\d+)/.exec(bubble)?.[1])).toBeGreaterThan(1100);
  });

  it('clips the sidebar instead of letting it scroll sideways', () => {
    expect(rule('.index-col')).toMatch(/overflow:\s*clip/);
  });
});

describe('styles.css — a caption is not a row', () => {
  it('sets a group caption smaller and lighter than the rows under it', () => {
    const caption = rule('.index-group');
    expect(caption).toMatch(/font-size:\s*var\(--type-micro\)/);
    expect(caption).toMatch(/font-weight:\s*500/);
    expect(caption).toMatch(/color:\s*var\(--color-text-dim\)/);
    expect(rule('.index-row')).toMatch(/font-size:\s*var\(--type-row\)/);
  });

  it('holds a caption closer to its own rows than to the group above', () => {
    const caption = rule('.index-group');
    expect(caption).toMatch(/margin-top:\s*var\(--space-16\)/);
    expect(caption).toMatch(/padding:\s*0 var\(--space-8\) var\(--space-4\)/);
  });
});

describe('styles.css — the terminal is part of the work panel', () => {
  it('sits on the panel’s own background, with no frame of another colour', () => {
    const host = rule('.term-pane__host');
    expect(host).toMatch(/background:\s*var\(--color-card-bg\)/);
    expect(rule('.bench')).toMatch(/background:\s*var\(--color-card-bg\)/);
  });

  it('pads the frame around the terminal, never the box xterm measures', () => {
    // xterm's fit reads the height of the box it is mounted in and takes that
    // box's padding for room: the bottom row was drawn half under the edge.
    expect(rule('.term-pane__host')).toMatch(/padding:/);
    const mount = rule('.term-pane__mount');
    expect(mount).not.toMatch(/padding/);
    expect(mount).toMatch(/flex:\s*1/);
    expect(mount).toMatch(/min-height:\s*0/);
  });
});

