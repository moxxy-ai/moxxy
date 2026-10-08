import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Nav } from './primitives';

/** One button on a step is lit: the thing the step is for. */

const lit = (name: string): boolean => screen.getByRole('button', { name }).classList.contains('btn-cta');

describe('the step footer', () => {
  it('lights the way forward once the step is done', () => {
    render(<Nav onBack={vi.fn()} onNext={vi.fn()} />);

    expect(lit('Continue')).toBe(true);
    expect(lit('Back')).toBe(false);
  });

  it('offers skipping quietly, so the step’s own action stays the lit one', () => {
    const onNext = vi.fn();
    render(<Nav onBack={vi.fn()} onNext={onNext} skip />);

    expect(lit('Skip for now')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(onNext).toHaveBeenCalledOnce();
  });
});
