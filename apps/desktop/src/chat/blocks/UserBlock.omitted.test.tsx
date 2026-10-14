import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AttachmentReaderContext } from '../attachments/AttachmentReaderContext';
import { UserBlock } from './UserBlock';

describe('UserBlock with attachments whose bytes stayed in the runner', () => {
  it('labels a left-out document with its real size', () => {
    render(
      <UserBlock
        text="the scan"
        seq={4}
        attachments={[
          { kind: 'document', content: '', mediaType: 'application/pdf', name: 'scan.pdf', omittedBytes: 20 * 1024 * 1024 },
        ]}
      />,
    );
    expect(screen.getByTitle('scan.pdf · 20.0 MB')).toBeTruthy();
  });

  it('reads a left-out image back and shows its thumbnail', async () => {
    const read = vi.fn(async () => 'QUJD');
    render(
      <AttachmentReaderContext.Provider value={read}>
        <UserBlock
          text="a screenshot"
          seq={4}
          attachments={[{ kind: 'image', content: '', mediaType: 'image/png', name: 'shot.png', omittedBytes: 3 * 1024 * 1024 }]}
        />
      </AttachmentReaderContext.Provider>,
    );
    const img = await screen.findByAltText('shot.png');
    expect(img.getAttribute('src')).toBe('data:image/png;base64,QUJD');
    expect(read).toHaveBeenCalledWith(4, 0);
  });

  it('falls back to a labelled chip when the image cannot be read', async () => {
    const read = vi.fn(async () => {
      throw new Error('gone');
    });
    render(
      <AttachmentReaderContext.Provider value={read}>
        <UserBlock
          text="a screenshot"
          seq={4}
          attachments={[{ kind: 'image', content: '', mediaType: 'image/png', name: 'shot.png', omittedBytes: 3 * 1024 * 1024 }]}
        />
      </AttachmentReaderContext.Provider>,
    );
    expect(await screen.findByTitle('shot.png · 3.0 MB')).toBeTruthy();
    expect(screen.queryByAltText('shot.png')).toBeNull();
  });
});
