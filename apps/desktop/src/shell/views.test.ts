import { describe, expect, it } from 'vitest';
import { DESTINATIONS, viewOf } from './navigation/destinations';
import { hasOwnIndex, showsRuns } from './views';

/**
 * No view stands without the sidebar: its account row is the way to every
 * other place, so a view with no list of its own keeps the runs beside it.
 */
describe('the sidebar a view shows', () => {
  it('gives every destination exactly one sidebar', () => {
    for (const destination of DESTINATIONS) {
      const view = viewOf(destination.id);
      expect(showsRuns(view) !== hasOwnIndex(view), view).toBe(true);
    }
  });

  it('keeps the runs beside a view that has no list of its own', () => {
    for (const view of ['chat', 'apps', 'collaborate', 'mobile'] as const) {
      expect(showsRuns(view), view).toBe(true);
    }
  });

  it('lets a view with sections of its own list those instead', () => {
    for (const view of ['automations', 'channels', 'extensions', 'settings'] as const) {
      expect(showsRuns(view), view).toBe(false);
    }
  });
});
