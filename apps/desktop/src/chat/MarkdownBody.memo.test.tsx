import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownBody } from './MarkdownBody';
import { STREAMING_PARSE_INTERVAL_MS } from './useStreamingMarkdownText';

vi.mock('react-markdown', () => ({
  default: vi.fn(({ children }: { children: string }) => <div data-testid="parsed">{children}</div>),
}));
vi.mock('remark-gfm', () => ({ default: () => undefined }));

const ReactMarkdown = (await import('react-markdown')).default as unknown as ReturnType<typeof vi.fn>;

/**
 * Markdown is re-parsed from scratch on every render, and a streaming turn
 * re-renders the transcript on every delta. Without memoisation that means
 * every visible message in the conversation re-parses on every delta — not just
 * the one being written — which a CPU profile of a live turn showed as the
 * heaviest app-level cost in the renderer.
 */
describe('MarkdownBody memoisation', () => {
  it('does not re-parse a message whose text has not changed', () => {
    ReactMarkdown.mockClear();
    const { rerender } = render(<MarkdownBody text="settled answer" />);
    expect(ReactMarkdown).toHaveBeenCalledTimes(1);

    // The parent re-renders on every delta of the message being streamed; this
    // one is finished and its props are identical.
    for (let delta = 0; delta < 8; delta += 1) rerender(<MarkdownBody text="settled answer" />);
    expect(ReactMarkdown).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('parsed').textContent).toBe('settled answer');
  });

  it('parses a growing message once per interval, not once per delta', () => {
    vi.useFakeTimers();
    ReactMarkdown.mockClear();
    const { rerender } = render(<MarkdownBody text="Hel" streaming />);
    const afterFirst = ReactMarkdown.mock.calls.length;

    // Three deltas inside one interval buy one parse between them, not three.
    rerender(<MarkdownBody text="Hello" streaming />);
    rerender(<MarkdownBody text="Hello wor" streaming />);
    rerender(<MarkdownBody text="Hello world" streaming />);
    expect(screen.getByTestId('parsed').textContent).toBe('Hel');

    act(() => { vi.advanceTimersByTime(STREAMING_PARSE_INTERVAL_MS); });
    expect(screen.getByTestId('parsed').textContent).toBe('Hello world');
    expect(ReactMarkdown.mock.calls.length).toBeLessThan(afterFirst + 3);

    // Whatever the throttle held back, finishing the turn publishes in full.
    rerender(<MarkdownBody text="Hello world, complete." />);
    expect(screen.getByTestId('parsed').textContent).toBe('Hello world, complete.');
    vi.useRealTimers();
  });

  it('re-renders when the streaming cursor is switched off', () => {
    ReactMarkdown.mockClear();
    const { container, rerender } = render(<MarkdownBody text="done" streaming />);
    expect(container.querySelector('.markdown-body')?.className).toContain('streaming');

    rerender(<MarkdownBody text="done" />);
    expect(container.querySelector('.markdown-body')?.className).not.toContain('streaming');
  });
});
