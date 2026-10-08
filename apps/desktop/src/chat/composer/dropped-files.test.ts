import { describe, expect, it } from 'vitest';
import { FILES_DROP_EVENT, carriesFiles, droppedFiles, emitDroppedFiles, type DroppedFiles } from './dropped-files';

/** What a drop hands over: jsdom has no DataTransfer to construct, so its shape is written out. */
function transfer(items: Array<{ file?: File; folder?: string; text?: string }>): DataTransfer {
  return {
    types: items.some((item) => item.text === undefined) ? ['Files'] : ['text/plain'],
    items: items.map((item) => ({
      kind: item.text === undefined ? 'file' : 'string',
      getAsFile: () => item.file ?? null,
      webkitGetAsEntry: () =>
        item.folder === undefined ? { isDirectory: false, name: item.file?.name ?? '' } : { isDirectory: true, name: item.folder },
    })),
  } as unknown as DataTransfer;
}

describe('carriesFiles', () => {
  it('tells a drag of files from a drag of text or of something in the window', () => {
    expect(carriesFiles({ types: ['Files'] })).toBe(true);
    expect(carriesFiles({ types: ['text/plain', 'text/html'] })).toBe(false);
    expect(carriesFiles(null)).toBe(false);
  });
});

describe('droppedFiles', () => {
  it('hands over the files and names the folders, which cannot be attached', () => {
    const notes = new File(['x'], 'notes.md');
    const shot = new File(['y'], 'shot.png');

    const dropped = droppedFiles(transfer([{ file: notes }, { folder: 'assets' }, { file: shot }, { text: 'dragged text' }]));

    expect(dropped.files).toEqual([notes, shot]);
    expect(dropped.folders).toEqual(['assets']);
  });
});

describe('emitDroppedFiles', () => {
  it('tells whoever listens for a drop on the chat', () => {
    const heard: DroppedFiles[] = [];
    const listen = (event: Event): void => void heard.push((event as CustomEvent<DroppedFiles>).detail);
    window.addEventListener(FILES_DROP_EVENT, listen);
    const dropped = { files: [new File(['x'], 'a.txt')], folders: [] };

    emitDroppedFiles(dropped);

    window.removeEventListener(FILES_DROP_EVENT, listen);
    expect(heard).toEqual([dropped]);
  });
});
