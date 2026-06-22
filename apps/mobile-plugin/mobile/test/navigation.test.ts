import { describe, expect, it } from 'vitest';
import { buildMobileMenuItems } from '../src/navigation';

describe('buildMobileMenuItems', () => {
  it('locks runner-backed menu routes while the selected session is loading', () => {
    const items = buildMobileMenuItems(0, {
      sessionLoading: true,
    });

    expect(
      items.map((item) => [item.label, item.disabled, item.disabledReason]),
    ).toEqual([
      ['Workflows', true, 'Selected session is still loading'],
      ['Scheduler', true, 'Selected session is still loading'],
      ['Settings', false, null],
      ['Gateway', false, null],
    ]);
  });
});
