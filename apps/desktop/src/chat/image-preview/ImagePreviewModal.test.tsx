import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImagePreviewModal } from './ImagePreviewModal';

const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('ImagePreviewModal', () => {
  it('renders a codex-style image lightbox with close and zoom controls', () => {
    const onClose = vi.fn();
    render(
      <ImagePreviewModal
        image={{
          name: 'screen.png',
          mediaType: 'image/png',
          base64: PNG_1x1,
        }}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole('dialog', { name: /screen\.png/i })).toBeInTheDocument();
    expect(screen.getByAltText('screen.png')).toHaveAttribute(
      'src',
      `data:image/png;base64,${PNG_1x1}`,
    );
    expect(screen.getByText('100%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /zoom in/i }));
    expect(screen.getByText('125%')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes from the backdrop and close button', () => {
    const onClose = vi.fn();
    render(
      <ImagePreviewModal
        image={{
          name: 'screen.png',
          mediaType: 'image/png',
          base64: PNG_1x1,
        }}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByTestId('image-preview-backdrop'));
    fireEvent.click(screen.getByRole('button', { name: /close image preview/i }));

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
