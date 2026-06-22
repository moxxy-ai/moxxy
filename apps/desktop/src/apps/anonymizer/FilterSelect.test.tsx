/**
 * Accessibility-focused tests for the redaction-filter multi-select. The panel
 * is an ARIA listbox; rows are options (role=option + aria-selected). These
 * assert the keyboard contract: focus lands on a real option when the panel
 * opens, Arrow keys rove (skipping disabled rows), Enter/Space toggle, and
 * Escape closes the panel + restores focus to the trigger.
 */
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { FilterSelect, type FilterOption } from './FilterSelect';

type Id = 'email' | 'phone' | 'names';

const OPTIONS: ReadonlyArray<FilterOption<Id>> = [
  { id: 'email', label: 'Emails' },
  { id: 'phone', label: 'Phone numbers' },
  { id: 'names', label: 'Names', disabled: true },
];

/** Controlled host: mirrors how AnonymizerApp drives the component so toggles
 *  re-render with the new selection. */
function Harness({
  initial = new Set<Id>(['email']),
  onChange,
}: {
  initial?: ReadonlySet<Id>;
  onChange?: (next: ReadonlySet<Id>) => void;
}): JSX.Element {
  const [selected, setSelected] = useState<ReadonlySet<Id>>(initial);
  return (
    <FilterSelect
      options={OPTIONS}
      selected={selected}
      onChange={(next) => {
        setSelected(next);
        onChange?.(next);
      }}
    />
  );
}

function openPanel(): void {
  fireEvent.click(screen.getByTestId('anon-filter-select'));
}

describe('FilterSelect accessibility', () => {
  it('renders rows as ARIA listbox options with aria-selected', () => {
    render(<Harness />);
    openPanel();

    const panel = screen.getByTestId('anon-filter-select-panel');
    expect(panel).toHaveAttribute('role', 'listbox');

    const emailOpt = screen.getByTestId('anon-filter-select-opt-email');
    const phoneOpt = screen.getByTestId('anon-filter-select-opt-phone');
    expect(emailOpt).toHaveAttribute('role', 'option');
    expect(emailOpt).toHaveAttribute('aria-selected', 'true');
    expect(phoneOpt).toHaveAttribute('aria-selected', 'false');
  });

  it('moves focus to the first selected option on open', () => {
    render(<Harness />);
    openPanel();
    expect(screen.getByTestId('anon-filter-select-opt-email')).toHaveFocus();
  });

  it('ArrowDown roves to the next selectable option and skips disabled rows', () => {
    render(<Harness />);
    openPanel();

    const email = screen.getByTestId('anon-filter-select-opt-email');
    const phone = screen.getByTestId('anon-filter-select-opt-phone');
    fireEvent.keyDown(email, { key: 'ArrowDown' });
    expect(phone).toHaveFocus();

    // 'names' is disabled — ArrowDown from the last selectable row wraps back to
    // the first selectable one rather than landing on the disabled row.
    fireEvent.keyDown(phone, { key: 'ArrowDown' });
    expect(email).toHaveFocus();

    const names = screen.getByTestId('anon-filter-select-opt-names');
    expect(names).toHaveAttribute('aria-disabled', 'true');
    expect(names).toHaveAttribute('tabindex', '-1');
  });

  it('ArrowUp wraps to the last selectable option, skipping disabled rows', () => {
    render(<Harness />);
    openPanel();

    const email = screen.getByTestId('anon-filter-select-opt-email');
    const phone = screen.getByTestId('anon-filter-select-opt-phone');
    fireEvent.keyDown(email, { key: 'ArrowUp' });
    // Skips the disabled 'names' row and wraps to 'phone'.
    expect(phone).toHaveFocus();
  });

  it('Enter toggles the focused option', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    openPanel();

    const email = screen.getByTestId('anon-filter-select-opt-email');
    expect(email).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(email, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('anon-filter-select-opt-email')).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('Space toggles the focused option on (and only once)', () => {
    const onChange = vi.fn();
    render(<Harness initial={new Set()} onChange={onChange} />);
    openPanel();

    const phone = screen.getByTestId('anon-filter-select-opt-phone');
    fireEvent.keyDown(phone, { key: ' ' });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('anon-filter-select-opt-phone')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('clicking a row body toggles exactly once (no double-toggle with the mirror checkbox)', () => {
    render(<Harness initial={new Set()} />);
    openPanel();

    const phone = screen.getByTestId('anon-filter-select-opt-phone');
    // Click the label span, not the checkbox, to exercise the row-body path.
    fireEvent.click(within(phone).getByText('Phone numbers'));
    expect(phone).toHaveAttribute('aria-selected', 'true');
  });

  it('Escape closes the panel and restores focus to the trigger', () => {
    render(<Harness />);
    const trigger = screen.getByTestId('anon-filter-select');
    fireEvent.click(trigger);
    expect(screen.getByTestId('anon-filter-select-panel')).toBeInTheDocument();

    // The document-level keydown listener owns Escape.
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByTestId('anon-filter-select-panel')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('disabled options are not focusable and cannot be toggled by keyboard', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    openPanel();

    const names = screen.getByTestId('anon-filter-select-opt-names');
    fireEvent.keyDown(names, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
