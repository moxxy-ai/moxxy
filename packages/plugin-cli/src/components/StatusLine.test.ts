import { describe, expect, it } from 'vitest';
import type { ClientChromeItem } from '@moxxy/sdk';
import { selectChromeItems, workspaceName } from './StatusLine.js';

describe('StatusLine product chrome', () => {
  it('uses the workspace name instead of runtime architecture', () => {
    expect(workspaceName('/work/acme-api')).toBe('acme-api');
    expect(workspaceName('')).toBe('workspace');
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
