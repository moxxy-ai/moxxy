import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useFocusTranscriptAutoScroll } from './useFocusTranscriptAutoScroll';

function Harness(): JSX.Element {
  const [contentKey, setContentKey] = useState('first');
  const transcript = useFocusTranscriptAutoScroll(contentKey);
  return (
    <>
      <div
        ref={transcript.bodyRef}
        data-testid="transcript"
        onScroll={transcript.onScroll}
      >
        <span>Selectable assistant answer</span>
      </div>
      <button type="button" onClick={() => setContentKey((key) => `${key}-next`)}>
        Append
      </button>
    </>
  );
}

function defineScrollGeometry(element: HTMLElement): void {
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: 100 },
    scrollHeight: { configurable: true, value: 500 },
  });
}

describe('useFocusTranscriptAutoScroll', () => {
  it('keeps a real text selection intact when new answer content arrives', () => {
    render(<Harness />);
    const transcript = screen.getByTestId('transcript');
    defineScrollGeometry(transcript);
    transcript.scrollTop = 400;

    const textNode = screen.getByText('Selectable assistant answer').firstChild;
    expect(textNode).not.toBeNull();
    const range = document.createRange();
    range.selectNodeContents(textNode as Node);
    const selection = window.getSelection();
    expect(selection).not.toBeNull();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent(document, new Event('selectionchange'));

    transcript.scrollTop = 240;
    fireEvent.click(screen.getByRole('button', { name: 'Append' }));

    expect(window.getSelection()?.toString()).toBe('Selectable assistant answer');
    expect(transcript.scrollTop).toBe(240);
  });

  it('respects manual scrollback and resumes following after returning to the bottom', () => {
    render(<Harness />);
    const transcript = screen.getByTestId('transcript');
    defineScrollGeometry(transcript);

    transcript.scrollTop = 100;
    fireEvent.scroll(transcript);
    fireEvent.click(screen.getByRole('button', { name: 'Append' }));
    expect(transcript.scrollTop).toBe(100);

    act(() => {
      window.getSelection()?.removeAllRanges();
      transcript.scrollTop = 400;
      fireEvent.scroll(transcript);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Append' }));
    expect(transcript.scrollTop).toBe(500);
  });
});
