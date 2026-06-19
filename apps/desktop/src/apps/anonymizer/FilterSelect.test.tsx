/**
 * Accessibility regression tests for the redaction-filter multi-select. The
 * panel must behave as a real ARIA listbox: option rows (not click-only divs),
 * arrow-key roving focus, Enter/Space to toggle, and Escape that returns focus
 * to the trigger instead of stranding it on <body>.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterSelect, type FilterOption } from './FilterSelect';

type Id = 'a' | 'b' | 'c' | 'x';

const OPTIONS: ReadonlyArray<FilterOption<Id>> = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
  { id: 'c', label: 'Gamma' },
  { id: 'x', label: 'Disabled', disabled: true },
];

function setup(selected: Id[] = ['a']) {
  const onChange = vi.fn();
  render(
    <FilterSelect options={OPTIONS} selected={new Set<Id>(selected)} onChange={onChange} />,
  );
  return { onChange };
}

describe('FilterSelect accessibility', () => {
  it('renders rows as ARIA options with aria-selected, not raw checkboxes', () => {
    setup(['a']);
    fireEvent.click(screen.getByTestId('anon-filter-select'));

    const alpha = screen.getByTestId('anon-filter-select-opt-a');
    expect(alpha).toHaveAttribute('role', 'option');
    expect(alpha).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('anon-filter-select-opt-b')).toHaveAttribute(
      'aria-selected',
      'false',
    );
    // No hidden native checkbox to mis-announce / steal focus invisibly.
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('opening the panel moves focus to a selectable option', () => {
    setup(['b']);
    fireEvent.click(screen.getByTestId('anon-filter-select'));
    // First selected option receives focus.
    expect(screen.getByTestId('anon-filter-select-opt-b')).toHaveFocus();
  });

  it('ArrowDown moves roving focus and skips disabled rows', () => {
    setup(['a']);
    fireEvent.click(screen.getByTestId('anon-filter-select'));

    const panel = screen.getByTestId('anon-filter-select-panel');
    fireEvent.keyDown(panel, { key: 'ArrowDown' });
    expect(screen.getByTestId('anon-filter-select-opt-b')).toHaveFocus();
    fireEvent.keyDown(panel, { key: 'ArrowDown' });
    expect(screen.getByTestId('anon-filter-select-opt-c')).toHaveFocus();
    // Next is the disabled row → wraps past it back to the first enabled option.
    fireEvent.keyDown(panel, { key: 'ArrowDown' });
    expect(screen.getByTestId('anon-filter-select-opt-a')).toHaveFocus();
  });

  it('Enter/Space on a focused option toggles it', () => {
    const { onChange } = setup(['a']);
    fireEvent.click(screen.getByTestId('anon-filter-select'));

    const beta = screen.getByTestId('anon-filter-select-opt-b');
    fireEvent.keyDown(beta, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as Set<Id>;
    expect(next.has('b')).toBe(true);
  });

  it('a disabled option cannot be toggled by keyboard or click', () => {
    const { onChange } = setup(['a']);
    fireEvent.click(screen.getByTestId('anon-filter-select'));

    const disabled = screen.getByTestId('anon-filter-select-opt-x');
    fireEvent.click(disabled);
    fireEvent.keyDown(disabled, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Escape closes the panel and restores focus to the trigger', () => {
    setup(['a']);
    const trigger = screen.getByTestId('anon-filter-select');
    fireEvent.click(trigger);
    expect(screen.getByTestId('anon-filter-select-panel')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('anon-filter-select-panel')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
