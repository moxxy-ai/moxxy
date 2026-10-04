import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Layout rules jsdom cannot measure, held as rules. Each one was a fault in the
 * packaged app: an invisible tooltip bubble widened the session list, so
 * anything that scrolled a row into view (focus, a click) slid the whole
 * sidebar left and cut "RUNS" to "UNS".
 */
const css = readFileSync(join(__dirname, 'styles.css'), 'utf8');

/** The declarations of the rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
  const at = css.search(new RegExp(`(^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`, 'm'));
  expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', at + 1);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('styles.css — what the eye does not see takes no room', () => {
  it('lays out no tooltip bubble until it shows', () => {
    expect(rule('.tip::after')).toMatch(/content:\s*none/);
    expect(rule('.tip:hover::after,\n.tip:focus-visible::after')).toMatch(/content:\s*attr\(data-tip\)/);
  });

  it('clips the sidebar instead of letting it scroll sideways', () => {
    expect(rule('.index-col')).toMatch(/overflow:\s*clip/);
  });
});
