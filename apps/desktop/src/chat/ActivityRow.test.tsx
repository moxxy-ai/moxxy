import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ActivityRow } from './ActivityRow';

describe('ActivityRow', () => {
  it('uses shimmer only while active and exposes disclosure state', () => {
    const toggle = vi.fn();
    const { rerender } = render(
      <ActivityRow icon="search" label="Searching…" active open={false} onToggle={toggle} testId="activity" />,
    );
    const row = screen.getByTestId('activity');
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Searching…')).toHaveClass('activity-shimmer');
    fireEvent.click(row);
    expect(toggle).toHaveBeenCalledOnce();

    rerender(<ActivityRow icon="search" label="Searched" open onToggle={toggle} testId="activity" />);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Searched')).not.toHaveClass('activity-shimmer');
  });
});
