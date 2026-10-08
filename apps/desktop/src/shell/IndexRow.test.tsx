import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IndexRow } from './IndexColumn';

/**
 * One row for every list the sidebar shows that is not a run: a settings
 * section, an automation, a channel. Drawn by the stylesheet so the three lists
 * cannot drift apart again.
 */

afterEach(cleanup);

describe('IndexRow', () => {
  it('is a button named by its label, with nothing styled inline', () => {
    render(<IndexRow label="Vault" active={false} onPick={() => {}} />);
    const row = screen.getByRole('button', { name: 'Vault' });
    expect(row).toHaveClass('index-row');
    expect(row).not.toHaveAttribute('style');
    expect(row).toHaveAttribute('data-active', 'false');
    expect(row).not.toHaveAttribute('aria-current');
  });

  it('marks the row that is open', () => {
    render(<IndexRow label="Vault" active onPick={() => {}} testId="row" />);
    const row = screen.getByTestId('row');
    expect(row).toHaveAttribute('data-active', 'true');
    expect(row).toHaveAttribute('aria-current', 'true');
  });

  it('shows a state light only when the row has a state to report', () => {
    const { container, rerender } = render(<IndexRow label="Vault" active={false} onPick={() => {}} />);
    expect(container.querySelector('.led')).toBeNull();
    rerender(<IndexRow label="nightly" active={false} onPick={() => {}} led="done" nested />);
    expect(container.querySelector('.led')).toHaveAttribute('data-state', 'done');
    expect(screen.getByRole('button')).toHaveAttribute('data-nested', 'true');
  });

  it('leads with an icon when the row is a place rather than a thing with a state', () => {
    const { container } = render(<IndexRow label="Vault" icon="lock" active={false} onPick={() => {}} />);
    expect(container.querySelector('svg.index-row__icon')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Vault' })).toBeInTheDocument();
  });

  it('trails a note, toned when it is a fault', () => {
    render(<IndexRow label="discord" active={false} onPick={() => {}} note="Error" noteTone="bad" />);
    const note = screen.getByText('Error');
    expect(note).toHaveClass('index-row__note');
    expect(note).toHaveAttribute('data-tone', 'bad');
  });

  it('picks itself when pressed', () => {
    const onPick = vi.fn();
    render(<IndexRow label="Vault" active={false} onPick={onPick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Vault' }));
    expect(onPick).toHaveBeenCalledTimes(1);
  });
});
