import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HINT_HOLD_MS, modifierKey, useModifierHeld } from './useModifierHeld';

/**
 * The shortcuts are shown to someone who holds the modifier and waits, not to
 * someone on the way to a chord they already know.
 */

function Probe({ mac = false }: { readonly mac?: boolean }): JSX.Element {
  return <span data-testid="held">{String(useModifierHeld(mac))}</span>;
}

const held = () => screen.getByTestId('held').textContent;
const down = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key, ...init });
const up = (key: string) => fireEvent.keyUp(window, { key });
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('modifierKey', () => {
  it('is Command on a Mac and Control everywhere else', () => {
    expect(modifierKey(true)).toBe('Meta');
    expect(modifierKey(false)).toBe('Control');
  });
});

describe('useModifierHeld', () => {
  it('is held once the modifier has been down by itself for a moment', () => {
    render(<Probe />);

    down('Control');
    wait(HINT_HOLD_MS - 1);
    expect(held()).toBe('false');
    wait(1);
    expect(held()).toBe('true');
  });

  it('lets go the moment the modifier comes up', () => {
    render(<Probe />);
    down('Control');
    wait(HINT_HOLD_MS);

    up('Control');

    expect(held()).toBe('false');
  });

  it('never shows for a chord: another key before the moment is up calls it off', () => {
    render(<Probe />);

    down('Control');
    wait(100);
    down('c', { ctrlKey: true });
    wait(HINT_HOLD_MS);

    expect(held()).toBe('false');
  });

  it('gets out of the way when the chord is pressed, a click lands, or the window is left', () => {
    for (const leave of [() => down('b', { ctrlKey: true }), () => fireEvent.mouseDown(document.body), () => fireEvent.blur(window)]) {
      const view = render(<Probe />);
      down('Control');
      wait(HINT_HOLD_MS);
      expect(held()).toBe('true');

      leave();

      expect(held()).toBe('false');
      view.unmount();
    }
  });

  it('does not start over while the key repeats', () => {
    render(<Probe />);

    down('Control');
    wait(HINT_HOLD_MS - 50);
    down('Control', { repeat: true });
    wait(50);

    expect(held()).toBe('true');
  });

  it('ignores AltGr, which Windows reports as Control then AltGraph', () => {
    render(<Probe />);

    down('Control');
    down('AltGraph', { ctrlKey: true });
    wait(HINT_HOLD_MS);

    expect(held()).toBe('false');
  });

  it('answers to Command on a Mac, and not to Control', () => {
    render(<Probe mac />);

    down('Control');
    wait(HINT_HOLD_MS);
    expect(held()).toBe('false');
    up('Control');

    down('Meta');
    wait(HINT_HOLD_MS);
    expect(held()).toBe('true');
  });
});
