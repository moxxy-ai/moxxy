import { describe, expect, it } from 'vitest';
import type { ClientChromeItem } from '@moxxy/sdk';
import { formatContextRemaining, selectChromeItems } from './StatusLine.js';

describe('StatusLine product chrome', () => {
  it('keeps remaining context compact across terminal widths', () => {
    expect(formatContextRemaining(32_000, 200_000)).toBe('ctx 84% left');
    expect(formatContextRemaining(32_000, 200_000, true)).toBe('ctx 168.0k left');
    expect(formatContextRemaining(250_000, 200_000)).toBe('ctx 0% left');
    expect(formatContextRemaining(10_000, null)).toBe('ctx —');
  });

  it('keeps only the highest-priority plugin items that fit the slot', () => {
    const item = (
      id: string,
      slot: ClientChromeItem['slot'],
      priority: number,
    ): ClientChromeItem => ({ id, source: 'test', slot, label: id, priority });
    const items = [
      item('low', 'status.trailing', 1),
      item('lead', 'status.leading', 100),
      item('high', 'status.trailing', 10),
    ];

    expect(selectChromeItems(items, 'status.trailing', 1).map((entry) => entry.id)).toEqual([
      'high',
    ]);
  });
});
