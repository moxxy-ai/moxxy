import { useRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resolveStreamingParseInterval,
  useStreamingMarkdownText,
  STREAMING_PARSE_INTERVAL_MS,
  STREAMING_PARSE_MAX_INTERVAL_MS,
} from './useStreamingMarkdownText';

function Probe({ text, streaming }: { readonly text: string; readonly streaming: boolean }) {
  const cost = useRef(0);
  return <span data-testid="shown">{useStreamingMarkdownText(text, streaming, cost)}</span>;
}

const shown = (): string => screen.getByTestId('shown').textContent ?? '';

describe('useStreamingMarkdownText', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('collapses the deltas that land inside one interval into a single update', () => {
    const { rerender } = render(<Probe text="a" streaming />);
    expect(shown()).toBe('a');

    for (const text of ['ab', 'abc', 'abcd', 'abcde']) rerender(<Probe text={text} streaming />);
    // Nothing published yet: the deltas are riding on one scheduled tick.
    expect(shown()).toBe('a');

    act(() => { vi.advanceTimersByTime(80); });
    expect(shown()).toBe('abcde');
  });

  it('publishes the final text immediately when the message stops streaming', () => {
    const { rerender } = render(<Probe text="par" streaming />);
    rerender(<Probe text="partial" streaming />);
    expect(shown()).toBe('par');

    // The turn ends before the pending tick would have fired.
    rerender(<Probe text="partial and complete" streaming={false} />);
    expect(shown()).toBe('partial and complete');
  });

  it('leaves a message that never streams entirely alone', () => {
    const { rerender } = render(<Probe text="static" streaming={false} />);
    expect(shown()).toBe('static');
    rerender(<Probe text="edited" streaming={false} />);
    expect(shown()).toBe('edited');
  });

  it('keeps publishing across successive intervals while text keeps arriving', () => {
    const { rerender } = render(<Probe text="1" streaming />);
    rerender(<Probe text="12" streaming />);
    act(() => { vi.advanceTimersByTime(80); });
    expect(shown()).toBe('12');

    rerender(<Probe text="123" streaming />);
    act(() => { vi.advanceTimersByTime(80); });
    expect(shown()).toBe('123');
  });
});

describe('resolveStreamingParseInterval', () => {
  it('holds Markdown to a fifth of the thread whatever the parse costs', () => {
    // Nothing measured yet, or a parse so cheap it does not matter: stay fast.
    expect(resolveStreamingParseInterval(0)).toBe(STREAMING_PARSE_INTERVAL_MS);
    expect(resolveStreamingParseInterval(10)).toBe(STREAMING_PARSE_INTERVAL_MS);
    // A parse that costs real time buys proportionally more silence after it,
    // so parsing settles at one part in five of the renderer.
    expect(resolveStreamingParseInterval(40)).toBe(200);
    expect(resolveStreamingParseInterval(200)).toBe(1_000);
    // Never so slow that a long answer visibly stalls.
    expect(resolveStreamingParseInterval(10_000)).toBe(STREAMING_PARSE_MAX_INTERVAL_MS);
    expect(resolveStreamingParseInterval(Number.NaN)).toBe(STREAMING_PARSE_INTERVAL_MS);
    expect(resolveStreamingParseInterval(-5)).toBe(STREAMING_PARSE_INTERVAL_MS);
  });
});
