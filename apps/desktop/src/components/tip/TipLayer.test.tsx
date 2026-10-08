import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TipLayer } from './TipLayer';

/**
 * One bubble for the whole window. A control asks for it with `data-tip`; the
 * bubble is drawn on the document body, so no scrolling or clipped panel
 * around the control can cut it.
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderBar(): void {
  render(
    <>
      <div style={{ overflow: 'hidden' }} data-testid="clipped-panel">
        <button type="button" data-tip="Hide sidebar" aria-label="Hide sidebar">
          <svg data-testid="icon" />
        </button>
        <button type="button" data-tip="New run" aria-label="New run" />
      </div>
      <TipLayer />
    </>,
  );
}

const bubble = (): HTMLElement | null => document.querySelector('.tip-bubble');
const settle = (ms: number): void => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe('TipLayer', () => {
  it('shows nothing until a control is pointed at, and then only after a pause', () => {
    renderBar();
    expect(bubble()).toBeNull();
    fireEvent.mouseOver(screen.getByTestId('icon'));
    settle(100);
    expect(bubble()).toBeNull();
    settle(100);
    expect(bubble()).toHaveTextContent('Hide sidebar');
  });

  it('draws the bubble on the body, outside whatever clips the control', () => {
    renderBar();
    fireEvent.mouseOver(screen.getByRole('button', { name: 'Hide sidebar' }));
    settle(200);
    const shown = bubble();
    expect(shown).not.toBeNull();
    expect(screen.getByTestId('clipped-panel').contains(shown)).toBe(false);
    expect(shown?.parentElement).toBe(document.body);
  });

  it('is decoration: the control keeps its own accessible name', () => {
    renderBar();
    fireEvent.mouseOver(screen.getByRole('button', { name: 'Hide sidebar' }));
    settle(200);
    expect(bubble()).toHaveAttribute('aria-hidden', 'true');
  });

  it('clears the moment the pointer leaves or the control is pressed', () => {
    renderBar();
    const control = screen.getByRole('button', { name: 'Hide sidebar' });
    fireEvent.mouseOver(control);
    settle(200);
    fireEvent.mouseOut(control, { relatedTarget: document.body });
    expect(bubble()).toBeNull();

    fireEvent.mouseOver(control);
    settle(200);
    fireEvent.mouseDown(control);
    expect(bubble()).toBeNull();
  });

  it('skips the pause, and the fade, when moving from one control to the next', () => {
    renderBar();
    const first = screen.getByRole('button', { name: 'Hide sidebar' });
    const second = screen.getByRole('button', { name: 'New run' });
    fireEvent.mouseOver(first);
    settle(200);
    expect(bubble()).not.toHaveAttribute('data-instant');
    fireEvent.mouseOut(first, { relatedTarget: second });
    fireEvent.mouseOver(second);
    expect(bubble()).toHaveTextContent('New run');
    expect(bubble()).toHaveAttribute('data-instant', 'true');
  });

  it('takes the pause again once the pointer has been away a while', () => {
    renderBar();
    const first = screen.getByRole('button', { name: 'Hide sidebar' });
    fireEvent.mouseOver(first);
    settle(200);
    fireEvent.mouseOut(first, { relatedTarget: document.body });
    settle(1000);
    fireEvent.mouseOver(screen.getByRole('button', { name: 'New run' }));
    expect(bubble()).toBeNull();
    settle(200);
    expect(bubble()).not.toHaveAttribute('data-instant');
  });

  it('follows keyboard focus, without the pause', () => {
    renderBar();
    const control = screen.getByRole('button', { name: 'New run' });
    act(() => control.focus());
    fireEvent.keyUp(control, { key: 'Tab' });
    expect(bubble()).toHaveTextContent('New run');
    act(() => control.blur());
    expect(bubble()).toBeNull();
  });

  it('closes when its control scrolls, and stays when something else does', () => {
    renderBar();
    const control = screen.getByRole('button', { name: 'Hide sidebar' });
    fireEvent.mouseOver(control);
    settle(200);
    const elsewhere = document.createElement('div');
    document.body.append(elsewhere);
    fireEvent.scroll(elsewhere);
    expect(bubble()).not.toBeNull();
    fireEvent.scroll(screen.getByTestId('clipped-panel'));
    expect(bubble()).toBeNull();
    elsewhere.remove();
  });

  it('never outlives a control that is taken off the screen', () => {
    renderBar();
    const control = screen.getByRole('button', { name: 'Hide sidebar' });
    fireEvent.mouseOver(control);
    settle(200);
    control.remove();
    fireEvent.mouseMove(document.body);
    expect(bubble()).toBeNull();
  });
});
