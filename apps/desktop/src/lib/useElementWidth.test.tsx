import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useElementWidth } from './useElementWidth';

/**
 * jsdom lays nothing out and has no ResizeObserver, so the browser's observer
 * is stood in for here: it is the one thing outside the hook.
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
  resize(width: number): void {
    this.report([{ borderBoxSize: [{ inlineSize: width, blockSize: 0 }] } as unknown as ResizeObserverEntry], this);
  }
}

function Probe(): JSX.Element {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  return <div ref={ref} data-testid="probe" data-width={width ?? 'unknown'} />;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  FakeResizeObserver.last = null;
});

describe('useElementWidth', () => {
  it('is unknown until the element has been measured', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    render(<Probe />);

    expect(screen.getByTestId('probe')).toHaveAttribute('data-width', 'unknown');
  });

  it('follows the element as it changes size, in whole pixels', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    render(<Probe />);

    act(() => FakeResizeObserver.last?.resize(183.4));
    expect(screen.getByTestId('probe')).toHaveAttribute('data-width', '184');
    act(() => FakeResizeObserver.last?.resize(210));
    expect(screen.getByTestId('probe')).toHaveAttribute('data-width', '210');
  });

  it('stops watching when the element goes away', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const { unmount } = render(<Probe />);
    const observer = FakeResizeObserver.last;

    unmount();

    expect(observer?.disconnected).toBe(true);
  });

  it('stays unknown where nothing can measure', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    render(<Probe />);

    expect(screen.getByTestId('probe')).toHaveAttribute('data-width', 'unknown');
  });
});
