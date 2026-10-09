import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FILES_DROP_EVENT, type DroppedFiles } from './composer/dropped-files';
import { useFileDropZone } from './useFileDropZone';

afterEach(cleanup);

function Zone(): JSX.Element {
  const drop = useFileDropZone();
  return (
    <div data-testid="zone" data-over={drop.over} {...drop.zone}>
      <p data-testid="inside">a message</p>
    </div>
  );
}

const notes = new File(['x'], 'notes.md');
/** A drag of files from outside the window, as the browser describes it. */
const files = {
  dataTransfer: {
    types: ['Files'],
    dropEffect: 'none',
    items: [{ kind: 'file', getAsFile: () => notes, webkitGetAsEntry: () => ({ isDirectory: false, name: 'notes.md' }) }],
  },
};
const text = { dataTransfer: { types: ['text/plain'], dropEffect: 'none', items: [] } };

const zone = () => screen.getByTestId('zone');
const over = () => zone().getAttribute('data-over');

describe('useFileDropZone', () => {
  it('knows when files are held over it, and when they have left', () => {
    render(<Zone />);
    expect(over()).toBe('false');

    fireEvent.dragEnter(zone(), files);
    expect(over()).toBe('true');
    fireEvent.dragLeave(zone(), files);
    expect(over()).toBe('false');
  });

  it('is still under the files while they cross what is inside it', () => {
    render(<Zone />);

    fireEvent.dragEnter(zone(), files);
    fireEvent.dragEnter(screen.getByTestId('inside'), files);
    fireEvent.dragLeave(zone(), files);

    expect(over()).toBe('true');
  });

  it('leaves a drag of text, or of something in the window, alone', () => {
    render(<Zone />);

    fireEvent.dragEnter(zone(), text);
    expect(over()).toBe('false');
    // Not claimed, so the field under it can still take the text.
    expect(fireEvent.dragOver(zone(), text)).toBe(true);
    expect(fireEvent.drop(zone(), text)).toBe(true);
  });

  it('says it will take the files, so the pointer shows a copy and the window does not open them', () => {
    render(<Zone />);

    expect(fireEvent.dragOver(zone(), files)).toBe(false);
    expect(files.dataTransfer.dropEffect).toBe('copy');
  });

  it('hands a drop to the composer and is no longer under anything', () => {
    const heard: DroppedFiles[] = [];
    const listen = (event: Event): void => void heard.push((event as CustomEvent<DroppedFiles>).detail);
    window.addEventListener(FILES_DROP_EVENT, listen);
    render(<Zone />);
    fireEvent.dragEnter(zone(), files);

    const unclaimed = fireEvent.drop(screen.getByTestId('inside'), files);

    window.removeEventListener(FILES_DROP_EVENT, listen);
    expect(unclaimed).toBe(false);
    expect(heard).toEqual([{ files: [notes], folders: [] }]);
    expect(over()).toBe('false');
  });
});
