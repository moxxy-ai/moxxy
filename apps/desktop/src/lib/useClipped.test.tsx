import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useClipped } from './useClipped';

/**
 * jsdom lays nothing out, so the sizes the browser would report are given to
 * the element here, and its ResizeObserver is stood in for: both are outside
 * the hook.
 */
class FakeResizeObserver {
  static last: FakeResizeObserver | null = null;
  disconnected = false;
  constructor(private readonly report: ResizeObserverCallback) {
    FakeResizeObserver.last = this;
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    this.disconnected = true;
  }
  resize(): void {
    this.report([], this);
  }
}

interface Box {
  readonly clientWidth: number;
  readonly scrollWidth: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
}

const ROOMY: Box = { clientWidth: 200, scrollWidth: 200, clientHeight: 32, scrollHeight: 32 };

function layOut(box: Box): void {
  for (const [name, value] of Object.entries(box)) {
    vi.spyOn(HTMLElement.prototype, name as keyof Box, 'get').mockReturnValue(value);
  }
}

function Probe({ text }: { readonly text: string }): JSX.Element {
  const { ref, clipped } = useClipped<HTMLSpanElement>(text);
  return (
    <span ref={ref} data-testid="probe" data-clipped={clipped}>
      {text}
    </span>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  FakeResizeObserver.last = null;
});

describe('useClipped', () => {
  it('is false for text that has room', () => {
    layOut(ROOMY);
    render(<Probe text="short" />);

    expect(screen.getByTestId('probe')).toHaveAttribute('data-clipped', 'false');
  });

  it('is true for a line cut at its end', () => {
    layOut({ ...ROOMY, scrollWidth: 340 });
    render(<Probe text="a long line" />);

    expect(screen.getByTestId('probe')).toHaveAttribute('data-clipped', 'true');
  });

  it('is true for a paragraph cut after its last allowed line', () => {
    layOut({ ...ROOMY, scrollHeight: 64 });
    render(<Probe text="a long paragraph" />);

    expect(screen.getByTestId('probe')).toHaveAttribute('data-clipped', 'true');
  });

  it('does not take a rounding pixel for a cut', () => {
    layOut({ ...ROOMY, scrollWidth: 201 });
    render(<Probe text="just fits" />);

    expect(screen.getByTestId('probe')).toHaveAttribute('data-clipped', 'false');
  });

  it('measures again when the element changes size', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    layOut(ROOMY);
    render(<Probe text="a long line" />);

    layOut({ ...ROOMY, clientWidth: 90 });
    act(() => FakeResizeObserver.last?.resize());

    expect(screen.getByTestId('probe')).toHaveAttribute('data-clipped', 'true');
  });

  it('measures again when the text changes', () => {
    layOut(ROOMY);
    const { rerender } = render(<Probe text="short" />);

    layOut({ ...ROOMY, scrollWidth: 340 });
    rerender(<Probe text="a much longer line than before" />);

    expect(screen.getByTestId('probe')).toHaveAttribute('data-clipped', 'true');
  });

  it('stops watching when the element goes away', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    layOut(ROOMY);
    const { unmount } = render(<Probe text="short" />);
    const observer = FakeResizeObserver.last;

    unmount();

    expect(observer?.disconnected).toBe(true);
  });
});
