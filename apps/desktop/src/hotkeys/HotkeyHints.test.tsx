import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HotkeyHints } from './HotkeyHints';
import { hintAnchor } from './hint-anchor';
import { hotkeys } from './registry';
import { HINT_HOLD_MS } from './useModifierHeld';

/**
 * Holding the modifier writes each control's shortcut on it, so a shortcut is
 * learned where it is used. The keymap is the one source: a control shows only
 * what is bound.
 */

let unbind: Array<() => void> = [];
const bind = (id: string, chord: string, disabled = false): void => {
  unbind.push(hotkeys.register({ id, chord, label: id, group: 'Test', run: () => {}, disabled }));
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  for (const off of unbind) off();
  unbind = [];
});

const hold = (): void => {
  fireEvent.keyDown(window, { key: 'Control' });
  act(() => void vi.advanceTimersByTime(HINT_HOLD_MS));
};
const hints = (): string[] => screen.queryAllByTestId('hotkey-hint').map((hint) => hint.textContent ?? '');

function Chrome(): JSX.Element {
  return (
    <>
      <button type="button" data-hotkey="view.sidebar">Sidebar</button>
      <button type="button" data-hotkey="view.workbench">Work panel</button>
      <button type="button" data-hotkey="session.new">New session</button>
      <button type="button" data-hotkey="nothing.bound">Other</button>
      <button type="button">No shortcut</button>
      <HotkeyHints />
    </>
  );
}

describe('HotkeyHints', () => {
  it('shows nothing until the modifier is held', () => {
    bind('view.sidebar', 'mod+b');
    render(<Chrome />);

    expect(hints()).toEqual([]);
  });

  it('writes the shortcut of every control that has one, as this keyboard writes it', () => {
    bind('view.sidebar', 'mod+b');
    bind('view.workbench', 'mod+j');
    render(<Chrome />);

    hold();

    expect(hints()).toEqual(['Ctrl+B', 'Ctrl+J']);
  });

  it('leaves out a shortcut that would do nothing now', () => {
    bind('view.sidebar', 'mod+b');
    bind('session.new', 'mod+n', true);
    render(<Chrome />);

    hold();

    expect(hints()).toEqual(['Ctrl+B']);
  });

  it('is for the eye only: the controls already carry their names', () => {
    bind('view.sidebar', 'mod+b');
    render(<Chrome />);

    hold();

    expect(screen.getByTestId('hotkey-hint').closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('goes when the modifier is let go', () => {
    bind('view.sidebar', 'mod+b');
    render(<Chrome />);
    hold();

    fireEvent.keyUp(window, { key: 'Control' });

    expect(hints()).toEqual([]);
  });
});

describe('hintAnchor', () => {
  const viewport = { width: 1200, height: 800 };

  it('sits on the middle of the control’s lower edge', () => {
    expect(hintAnchor({ left: 100, top: 40, width: 28, height: 28 }, viewport)).toEqual({ left: 114, top: 68 });
  });

  it('stays inside the window beside its edges', () => {
    expect(hintAnchor({ left: 0, top: 0, width: 20, height: 20 }, viewport)).toMatchObject({ left: 28 });
    expect(hintAnchor({ left: 1190, top: 0, width: 20, height: 20 }, viewport)).toMatchObject({ left: 1172 });
    expect(hintAnchor({ left: 100, top: 790, width: 20, height: 20 }, viewport)).toMatchObject({ top: 788 });
  });

  it('is nowhere for a control that is outside the window', () => {
    expect(hintAnchor({ left: -200, top: 40, width: 28, height: 28 }, viewport)).toBeNull();
    expect(hintAnchor({ left: 100, top: 900, width: 28, height: 28 }, viewport)).toBeNull();
  });
});
