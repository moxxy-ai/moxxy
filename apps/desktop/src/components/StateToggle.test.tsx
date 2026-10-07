import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StateToggle } from './StateToggle';

/**
 * Whether a thing is switched on reads as a word in a chip, and the chip is
 * what switches it. The lists of workflows, schedules and webhooks share it.
 */

afterEach(cleanup);

describe('StateToggle', () => {
  it('reads "On" in the good tone and offers to disable', () => {
    render(<StateToggle enabled name="nightly-triage" onToggle={() => {}} />);
    const chip = screen.getByRole('button', { name: 'Disable nightly-triage' });
    expect(chip.textContent).toBe('On');
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(chip).toHaveAttribute('data-tone', 'good');
  });

  it('reads "Paused" with no tone and offers to enable', () => {
    render(<StateToggle enabled={false} name="nightly-triage" onToggle={() => {}} />);
    const chip = screen.getByRole('button', { name: 'Enable nightly-triage' });
    expect(chip.textContent).toBe('Paused');
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    expect(chip).not.toHaveAttribute('data-tone');
  });

  it('is coloured by the stylesheet, not inline', () => {
    render(<StateToggle enabled name="x" onToggle={() => {}} />);
    const chip = screen.getByRole('button');
    expect(chip).toHaveClass('tag', 'tag--press');
    expect(chip).not.toHaveAttribute('style');
  });

  it('asks for the opposite state when pressed', () => {
    const onToggle = vi.fn();
    render(<StateToggle enabled name="x" onToggle={onToggle} testId="toggle-x" />);
    fireEvent.click(screen.getByTestId('toggle-x'));
    expect(onToggle).toHaveBeenCalledWith(false);
  });
});
