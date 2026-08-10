import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QueuedChip } from './QueuedChip';

describe('QueuedChip compact presentation', () => {
  it('keeps the cancel action visible and removes decorative progress UI', () => {
    const onRemove = vi.fn();

    render(
      <QueuedChip
        text="A queued follow-up that is intentionally longer than the compact strip"
        onRemove={onRemove}
        compact
      />,
    );

    expect(screen.getByText('Queued')).toBeTruthy();
    expect(screen.queryByTestId('queued-pulse')).toBeNull();

    const remove = screen.getByRole('button', { name: /drop queued message/i });
    expect(remove.style.flexShrink).toBe('0');
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
