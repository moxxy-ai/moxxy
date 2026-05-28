import { describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Transcript } from './transcript';
import type { Block } from '@/lib/runner-session';

function makeBlocks(n: number): Block[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `b${i}`,
    kind: 'user' as const,
    text: `msg ${i}`,
  }));
}

describe('<Transcript />', () => {
  it('renders each block', () => {
    render(<Transcript blocks={makeBlocks(3)} />);
    const transcript = screen.getByTestId('transcript');
    expect(transcript.querySelectorAll('[data-testid="block-user"]').length).toBe(
      3,
    );
  });

  it('auto-scrolls to the bottom when new blocks arrive', () => {
    // jsdom doesn't lay out scroll; we patch scrollTop/scrollHeight to
    // simulate a long transcript and verify the effect runs.
    const { rerender } = render(<Transcript blocks={makeBlocks(1)} />);
    const el = screen.getByTestId('transcript') as HTMLDivElement;

    Object.defineProperty(el, 'scrollHeight', {
      configurable: true,
      get: () => 1000,
    });
    Object.defineProperty(el, 'clientHeight', {
      configurable: true,
      get: () => 200,
    });

    const setSpy = vi.spyOn(el, 'scrollTop', 'set');
    act(() => {
      rerender(<Transcript blocks={makeBlocks(5)} />);
    });
    expect(setSpy).toHaveBeenCalled();
  });

  it('stops following when the user scrolls up', () => {
    const { rerender } = render(<Transcript blocks={makeBlocks(1)} />);
    const el = screen.getByTestId('transcript') as HTMLDivElement;

    Object.defineProperty(el, 'scrollHeight', {
      configurable: true,
      get: () => 1000,
    });
    Object.defineProperty(el, 'clientHeight', {
      configurable: true,
      get: () => 200,
    });
    // Simulate the user being well above the bottom.
    Object.defineProperty(el, 'scrollTop', {
      configurable: true,
      get: () => 100,
      set: () => {},
    });

    act(() => {
      el.dispatchEvent(new Event('scroll'));
    });

    // Now redefine scrollTop as a spy to confirm it isn't auto-set.
    const setSpy = vi.fn();
    Object.defineProperty(el, 'scrollTop', {
      configurable: true,
      get: () => 100,
      set: setSpy,
    });
    act(() => {
      rerender(<Transcript blocks={makeBlocks(5)} />);
    });
    expect(setSpy).not.toHaveBeenCalled();
  });
});
