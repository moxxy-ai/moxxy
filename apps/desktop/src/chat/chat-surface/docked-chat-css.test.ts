import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** Every rule whose selector list names `selector`, as `{ … }` bodies. */
function rulesFor(selector: string): string[] {
  const rules = [...stylesheet.matchAll(/([^{}]+)\{([^}]*)\}/g)];
  return rules
    .filter(([, selectors]) => (selectors ?? '').split(',').some((s) => s.trim() === selector))
    .map(([, , body]) => body ?? '');
}

/**
 * The floating composer's menus (the + menu, the mode submenu) open upward out
 * of the composer. Clipping the composer to its rounded card cut them off at
 * its top edge.
 */
describe('docked chat stylesheet', () => {
  it('does not clip the floating composer, so its menus can open past its edge', () => {
    const bodies = rulesFor('.col-main--docked .cmdbar');
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) expect(body).not.toMatch(/overflow:\s*(hidden|clip)/);
  });
});
