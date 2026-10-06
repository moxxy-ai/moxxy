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

function Harness({ toggleBenchFull }: { readonly toggleBenchFull: () => void }): null {
  useHotkeyDispatcher();
  useAppHotkeys({
    setView: vi.fn(),
    benchTab: 'browser',
    setBenchTab: vi.fn(),
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
