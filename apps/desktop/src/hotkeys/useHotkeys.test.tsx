import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ShortcutsSheet } from './ShortcutsSheet';
import { useHotkey, useHotkeyDispatcher } from './useHotkeys';

function Harness({
  onRun,
  chord = 'mod+k',
}: {
  readonly onRun: () => void;
  readonly chord?: string;
}): JSX.Element {
  useHotkeyDispatcher();
  useHotkey({ id: 'test.binding', chord, label: 'Do the thing', group: 'Testing', run: onRun });
  return (
    <div>
      <button type="button" onKeyDown={(e) => e.preventDefault()}>
        swallows keys
      </button>
      <textarea aria-label="draft" />
    </div>
  );
}

describe('useHotkeyDispatcher', () => {
  it('runs the bound action on a matching key event', () => {
    const run = vi.fn();
    render(<Harness onRun={run} />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(run).toHaveBeenCalledOnce();
  });

  it('ignores an event a component already handled', () => {
    const run = vi.fn();
    render(<Harness onRun={run} />);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'k', metaKey: true });
    expect(run).not.toHaveBeenCalled();
  });

  it('unregisters when the owner unmounts', () => {
    const run = vi.fn();
    const view = render(<Harness onRun={run} />);
    view.unmount();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(run).not.toHaveBeenCalled();
  });

  it('still fires a modified chord while the user is typing', () => {
    const run = vi.fn();
    render(<Harness onRun={run} />);
    fireEvent.keyDown(screen.getByLabelText('draft'), { key: 'k', metaKey: true });
    expect(run).toHaveBeenCalledOnce();
  });
});

describe('ShortcutsSheet', () => {
  it('lists what is actually bound, so the reference cannot drift', () => {
    const run = vi.fn();
    render(<Harness onRun={run} chord="mod+shift+p" />);
    render(<ShortcutsSheet onClose={() => {}} />);
    expect(screen.getByText('Do the thing')).toBeInTheDocument();
    expect(screen.getByText('Testing')).toBeInTheDocument();
    // The rendered chord matches the registered spec.
    expect(screen.getByText(/[⌘⇧]P|Ctrl\+Shift\+P/)).toBeInTheDocument();
  });
});
