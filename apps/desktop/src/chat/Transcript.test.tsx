/**
 * Transcript ↔ Virtuoso wiring (Virtuoso itself is mocked — jsdom can't
 * measure a virtualised scroller, so we capture the props Transcript hands
 * it and drive the callbacks directly):
 *   1. Stick-to-bottom: `followOutput` returns false when scrolled up,
 *      'auto' while streaming (rapid chunks must pin instantly), and
 *      'smooth' for a committed line; `atBottomThreshold` carries slack.
 *   2. The jump button is hidden at the bottom, appears after
 *      `atBottomStateChange(false)`, and clicking it calls
 *      scrollToIndex({ index: 'LAST', … }) on the handle.
 *   3. An upward-pagination prepend shifts `firstItemIndex` down by the
 *      prepended row count and never flags the unread dot.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { MoxxyEvent } from '@moxxy/sdk';
import { Transcript } from './Transcript';

interface CapturedProps {
  followOutput: (isAtBottom: boolean) => false | 'smooth' | 'auto';
  atTopStateChange?: (atTop: boolean) => void;
  atBottomStateChange: (atBottom: boolean) => void;
  atBottomThreshold: number;
  firstItemIndex: number;
  initialTopMostItemIndex: number;
}

const captured = vi.hoisted(() => ({
  props: null as CapturedProps | null,
  scrollToIndex: vi.fn(),
}));

vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  return {
    Virtuoso: React.forwardRef(function MockVirtuoso(
      props: Record<string, unknown>,
      ref: React.Ref<unknown>,
    ) {
      captured.props = props as unknown as CapturedProps;
      React.useImperativeHandle(ref, () => ({ scrollToIndex: captured.scrollToIndex }));
      return React.createElement('div', { 'data-testid': 'virtuoso-mock' });
    }),
  };
});

function userPrompt(id: string, text: string): MoxxyEvent {
  return {
    type: 'user_prompt',
    text,
    id,
    seq: 1,
    ts: 1,
    sessionId: 's1',
    turnId: 't1',
    source: 'user',
  } as unknown as MoxxyEvent;
}

function assistantMessage(id: string, content: string): MoxxyEvent {
  return {
    type: 'assistant_message',
    content,
    stopReason: 'end_turn',
    id,
    seq: 1,
    ts: 1,
    sessionId: 's1',
    turnId: 't1',
    source: 'assistant',
  } as unknown as MoxxyEvent;
}

function toolRequest(id: string, callId: string): MoxxyEvent {
  return {
    type: 'tool_call_requested',
    callId,
    name: 'Bash',
    input: { command: 'pwd' },
    id,
    seq: 1,
    ts: 1,
    sessionId: 's1',
    turnId: 't1',
    source: 'model',
  } as unknown as MoxxyEvent;
}

function renderTranscript(
  overrides: Partial<React.ComponentProps<typeof Transcript>> = {},
): ReturnType<typeof render> {
  return render(
    <Transcript events={[userPrompt('e1', 'hi')]} extensions={[]} streamingText="" {...overrides} />,
  );
}

beforeEach(() => {
  captured.props = null;
  captured.scrollToIndex.mockClear();
});

describe('Transcript stick-to-bottom wiring', () => {
  it('followOutput pins instantly while streaming, smoothly otherwise, never when scrolled up', () => {
    const { rerender } = renderTranscript();
    expect(captured.props?.followOutput(true)).toBe('smooth');
    expect(captured.props?.followOutput(false)).toBe(false);
    rerender(
      <Transcript events={[userPrompt('e1', 'hi')]} extensions={[]} streamingText="chunk" />,
    );
    expect(captured.props?.followOutput(true)).toBe('auto');
    expect(captured.props?.followOutput(false)).toBe(false);
    // Slack so trackpad jitter near the bottom doesn't break the follow.
    expect(captured.props?.atBottomThreshold).toBe(80);
  });

  it('mounts at the bottom (initialTopMostItemIndex = last row) with no button', () => {
    renderTranscript();
    expect(captured.props?.initialTopMostItemIndex).toBe(0);
    expect(screen.queryByTestId('scroll-to-bottom')).not.toBeInTheDocument();
  });

  it('shows the jump button when scrolled up; clicking jumps instantly to LAST and it hides at bottom', () => {
    renderTranscript();
    act(() => captured.props?.atBottomStateChange(false));
    const btn = screen.getByTestId('scroll-to-bottom');
    fireEvent.click(btn);
    expect(captured.scrollToIndex).toHaveBeenCalledWith({
      index: 'LAST',
      align: 'end',
      behavior: 'auto',
    });
    // Landing at the bottom re-enables stick-to-bottom and hides the button.
    act(() => captured.props?.atBottomStateChange(true));
    expect(screen.queryByTestId('scroll-to-bottom')).not.toBeInTheDocument();
  });

  it('flags unread when chunks stream in while scrolled up', () => {
    const { rerender } = renderTranscript();
    act(() => captured.props?.atBottomStateChange(false));
    expect(screen.queryByTestId('scroll-to-bottom-unread')).not.toBeInTheDocument();
    rerender(
      <Transcript events={[userPrompt('e1', 'hi')]} extensions={[]} streamingText="more text" />,
    );
    expect(screen.getByTestId('scroll-to-bottom-unread')).toBeInTheDocument();
  });

  it('prepending older history shifts firstItemIndex and does not flag unread', () => {
    const e2 = userPrompt('e2', 'newest');
    const { rerender } = render(<Transcript events={[e2]} extensions={[]} streamingText="" />);
    const before = captured.props?.firstItemIndex ?? 0;
    act(() => captured.props?.atBottomStateChange(false));
    // Older page lands at the head; the tail row is unchanged.
    rerender(
      <Transcript events={[userPrompt('e1', 'older'), e2]} extensions={[]} streamingText="" />,
    );
    expect(captured.props?.firstItemIndex).toBe(before - 1);
    expect(screen.queryByTestId('scroll-to-bottom-unread')).not.toBeInTheDocument();
  });

  it('requests older history when hasOlder appears while the scroller is already at the top', () => {
    const onReachedTop = vi.fn();
    const e1 = userPrompt('e1', 'newest');
    const { rerender } = render(
      <Transcript
        events={[e1]}
        extensions={[]}
        streamingText=""
        hasOlder={false}
        onReachedTop={onReachedTop}
      />,
    );

    const onAtTop = captured.props?.atTopStateChange;
    act(() => onAtTop?.(true));
    rerender(
      <Transcript
        events={[e1]}
        extensions={[]}
        streamingText=""
        hasOlder
        onReachedTop={onReachedTop}
      />,
    );

    expect(onReachedTop).toHaveBeenCalledTimes(1);
  });

  it('anchors pagination when an older page expands the head tool group', () => {
    const t2 = toolRequest('tool-2', 'call-2');
    const t3 = toolRequest('tool-3', 'call-3');
    const tail = assistantMessage('tail', 'done');
    const { rerender } = render(
      <Transcript events={[t2, t3, tail]} extensions={[]} streamingText="" workspaceId="s1" />,
    );
    const before = captured.props?.firstItemIndex ?? 0;

    rerender(
      <Transcript
        events={[
          userPrompt('older-user', 'older'),
          assistantMessage('older-assistant', 'older answer'),
          toolRequest('tool-1', 'call-1'),
          t2,
          t3,
          tail,
        ]}
        extensions={[]}
        streamingText=""
        workspaceId="s1"
      />,
    );

    expect(captured.props?.firstItemIndex).toBe(before - 2);
  });

  it('resets pagination anchoring when switching sessions', () => {
    const oldHead = userPrompt('old-head', 'old head');
    const { rerender } = render(
      <Transcript
        events={[oldHead, userPrompt('old-tail', 'old tail')]}
        extensions={[]}
        streamingText=""
        workspaceId="s1"
      />,
    );
    const before = captured.props?.firstItemIndex ?? 0;

    rerender(
      <Transcript
        events={[userPrompt('new-head', 'new session'), oldHead, userPrompt('new-tail', 'new tail')]}
        extensions={[]}
        streamingText=""
        workspaceId="s2"
      />,
    );

    expect(captured.props?.firstItemIndex).toBe(before);
  });
});
