import type { ComponentType } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AttachmentChip } from './AttachmentChip';

describe('AttachmentChip image preview', () => {
  it('opens image preview from the staged attachment without removing it', () => {
    const onPreview = vi.fn();
    const onRemove = vi.fn();
    const Component = AttachmentChip as ComponentType<Record<string, unknown>>;

    render(
      <Component
        name="screen.png"
        path="/tmp/screen.png"
        preview={{
          name: 'screen.png',
          mediaType: 'image/png',
          base64: 'AAAA',
        }}
        onPreview={onPreview}
        onRemove={onRemove}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /preview screen\.png/i }));
    expect(onPreview).toHaveBeenCalledWith({
      name: 'screen.png',
      mediaType: 'image/png',
      base64: 'AAAA',
    });
    expect(onRemove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /remove screen\.png/i }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenCalledTimes(1);
  });

  it('keeps non-image attachments as plain removable chips', () => {
    const onRemove = vi.fn();

    render(<AttachmentChip name="readme.md" path="/tmp/readme.md" onRemove={onRemove} />);

    expect(screen.queryByRole('button', { name: /preview readme\.md/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /remove readme\.md/i }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
