import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('pans a zoomed image by dragging it with the mouse', async () => {
    render(
      <ImagePreviewModal
        image={{
          name: 'screen.png',
          mediaType: 'image/png',
          base64: PNG_1x1,
        }}
        onClose={() => undefined}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: /screen\.png/i });
    const image = screen.getByAltText('screen.png');
    Object.defineProperty(dialog, 'clientWidth', { configurable: true, value: 500 });
    Object.defineProperty(dialog, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(image, 'clientWidth', { configurable: true, value: 800 });
    Object.defineProperty(image, 'clientHeight', { configurable: true, value: 500 });

    fireEvent.click(screen.getByRole('button', { name: /zoom in/i }));
    fireEvent.mouseDown(image, { button: 0, clientX: 100, clientY: 100 });
    await waitFor(() => expect(image).toHaveStyle({ cursor: 'grabbing' }));

    fireEvent.mouseMove(document, { clientX: 160, clientY: 130 });
    fireEvent.mouseUp(document);

    expect(image).toHaveStyle({
      transform: 'translate(60px, 30px) scale(1.25)',
      cursor: 'grab',
    });
  });
});
