import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModeChip } from './ModeChip';

/**
 * The mode the next turn will run in, said in the composer whenever it is not
 * the default one. Every mode says it the same way; one that runs unattended
 * takes the caution tone.
 */

afterEach(cleanup);

describe('ModeChip', () => {
  it('names the mode and what is particular about it', () => {
    render(<ModeChip mode="plan" busy={false} onLeave={() => {}} />);
    const chip = screen.getByTestId('composer-mode');
    expect(chip).toHaveTextContent('Plan mode · read-only');
    expect(chip).toHaveClass('status-chip');
    expect(chip).toHaveAttribute('data-tone', 'accent');
    expect(chip).toHaveAttribute('data-tip', 'Reads only, then writes a plan');
  });

  it('cautions about a mode that works unattended', () => {
    render(<ModeChip mode="goal" busy={false} onLeave={() => {}} />);
    const chip = screen.getByTestId('composer-mode');
    expect(chip).toHaveTextContent('Goal mode · unattended');
    expect(chip).toHaveAttribute('data-tone', 'warn');
  });

  it('leaves the mode in one press', () => {
    const onLeave = vi.fn();
    render(<ModeChip mode="research" busy={false} onLeave={onLeave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to Default mode' }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('cannot leave while a turn is running in it', () => {
    render(<ModeChip mode="goal" busy onLeave={() => {}} />);
    expect(screen.getByRole('button', { name: 'Back to Default mode' })).toBeDisabled();
  });
});
