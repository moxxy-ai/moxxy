/**
 * JumpToLatest button + useNewContentBelow hook:
 *   1. The button only mounts while `visible` (i.e. user scrolled up),
 *      exposes the aria-label/testid contract, and fires onJump on click.
 *   2. The unread dot rides on `unread`.
 *   3. useNewContentBelow flags appended content only while scrolled up,
 *      ignores key changes at the bottom, and resets when the user
 *      returns to the bottom. A stable key (upward-pagination prepend)
 *      never flags.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { JumpToLatest, useNewContentBelow } from './JumpToLatest';

describe('JumpToLatest', () => {
  it('renders nothing while at the bottom (visible=false)', () => {
    render(<JumpToLatest visible={false} unread={false} onJump={() => {}} />);
    expect(screen.queryByTestId('scroll-to-bottom')).not.toBeInTheDocument();
  });

  it('shows the button when scrolled up and fires onJump on click', () => {
    const onJump = vi.fn();
    render(<JumpToLatest visible unread={false} onJump={onJump} />);
    const btn = screen.getByTestId('scroll-to-bottom');
    expect(btn).toHaveAccessibleName('Scroll to latest');
    fireEvent.click(btn);
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it('shows the unread dot only when unread', () => {
    const { rerender } = render(<JumpToLatest visible unread={false} onJump={() => {}} />);
    expect(screen.queryByTestId('scroll-to-bottom-unread')).not.toBeInTheDocument();
    rerender(<JumpToLatest visible unread onJump={() => {}} />);
    expect(screen.getByTestId('scroll-to-bottom-unread')).toBeInTheDocument();
  });
});

/** Tiny harness exposing the hook's output as a testable DOM flag. */
function Probe({ atBottom, contentKey }: { atBottom: boolean; contentKey: string }): JSX.Element {
  const unread = useNewContentBelow(atBottom, contentKey);
  return <output data-testid="unread">{String(unread)}</output>;
}

describe('useNewContentBelow', () => {
  it('stays false while at the bottom even as content appends', () => {
    const { rerender } = render(<Probe atBottom contentKey="a:0" />);
    rerender(<Probe atBottom contentKey="b:0" />);
    rerender(<Probe atBottom contentKey="b:42" />);
    expect(screen.getByTestId('unread')).toHaveTextContent('false');
  });

  it('flips true when content appends while scrolled up, and resets at bottom', () => {
    const { rerender } = render(<Probe atBottom contentKey="a:0" />);
    rerender(<Probe atBottom={false} contentKey="a:0" />);
    // No new content yet — just scrolling up must not flag.
    expect(screen.getByTestId('unread')).toHaveTextContent('false');
    // A streaming chunk arrives below.
    rerender(<Probe atBottom={false} contentKey="a:17" />);
    expect(screen.getByTestId('unread')).toHaveTextContent('true');
    // Returning to the bottom clears the hint.
    rerender(<Probe atBottom contentKey="a:17" />);
    expect(screen.getByTestId('unread')).toHaveTextContent('false');
  });

  it('ignores a stable key while scrolled up (upward-pagination prepend)', () => {
    const { rerender } = render(<Probe atBottom contentKey="tail:0" />);
    rerender(<Probe atBottom={false} contentKey="tail:0" />);
    // Prepending history does not change the tail key — no unread hint.
    rerender(<Probe atBottom={false} contentKey="tail:0" />);
    expect(screen.getByTestId('unread')).toHaveTextContent('false');
  });
});
