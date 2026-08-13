import { describe, expect, it } from 'vitest';
import { fitPickerOption } from './ListPicker.js';

describe('fitPickerOption', () => {
  it('keeps a long run title and its metadata on one bounded row', () => {
    const fitted = fitPickerOption(
      {
        id: 'run',
        label: 'Fetch the latest news about newly released AI models and compare every result',
        description: '10d ago · a-very-long-workspace-name',
      },
      72,
    );
    const rendered = fitted.label + fitted.current + '  — ' + fitted.description;
    expect(rendered.length).toBeLessThanOrEqual(72);
    expect(fitted.label).toContain('…');
  });

  it('does not repeat current when an explicit current badge is present', () => {
    const fitted = fitPickerOption(
      { id: 'run', label: '(empty run)', current: true, badge: 'current' },
      72,
    );
    expect(fitted.current).toBe('');
  });
});
