import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { useHotkeyDispatcher } from './useHotkeys';
import { useAppHotkeys } from './useAppHotkeys';

beforeEach(() => {
  __setApiOverride({
    invoke: vi.fn(async () => ({ desks: [], activeId: null })),
    subscribe: () => () => undefined,
  } as unknown as MoxxyApi);
});
afterEach(() => __setApiOverride(null));

function Harness({
  toggleBenchFull,
  toggleBench = vi.fn(),
  setView = vi.fn(),
  onOpenPalette = vi.fn(),
}: {
  readonly toggleBenchFull: () => void;
  readonly toggleBench?: () => void;
  readonly setView?: (view: string) => void;
  readonly onOpenPalette?: () => void;
}): null {
  useHotkeyDispatcher();
  useAppHotkeys({
    setView,
    onOpenPalette,
    toggleBench,
    toggleBenchFull,
    onShowShortcuts: vi.fn(),
  });
  return null;
}

/** ⇧⌘F is the full-view chord Codex uses; ⌘F stays transcript search. */
describe('useAppHotkeys, full view', () => {
  it('toggles full view on ⇧⌘F', () => {
    const toggle = vi.fn();
    render(<Harness toggleBenchFull={toggle} />);
    fireEvent.keyDown(window, { key: 'F', metaKey: true, shiftKey: true });
    expect(toggle).toHaveBeenCalledOnce();
  });

  it('leaves ⌘F to transcript search', () => {
    const toggle = vi.fn();
    render(<Harness toggleBenchFull={toggle} />);
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    expect(toggle).not.toHaveBeenCalled();
  });
});

/** The palette is the fast way to every place, so it opens over whatever is on
 *  screen instead of first dragging the user back to the conversation. */
describe('useAppHotkeys, palette', () => {
  it('opens the palette on ⌘K without leaving the current view', () => {
    const setView = vi.fn();
    const onOpenPalette = vi.fn();
    render(<Harness toggleBenchFull={vi.fn()} setView={setView} onOpenPalette={onOpenPalette} />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(onOpenPalette).toHaveBeenCalledOnce();
    expect(setView).not.toHaveBeenCalled();
  });
});

/** One toggle, the same one the header's button uses, so the shortcut and the
 *  button cannot disagree about which pane comes back. */
describe('useAppHotkeys, work panel', () => {
  it('shows or hides the work panel on ⌘J', () => {
    const toggleBench = vi.fn();
    render(<Harness toggleBenchFull={vi.fn()} toggleBench={toggleBench} />);
    fireEvent.keyDown(window, { key: 'j', metaKey: true });
    expect(toggleBench).toHaveBeenCalledOnce();
  });
});
