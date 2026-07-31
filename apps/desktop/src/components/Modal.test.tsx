import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button, Modal, ModalFooter } from '@moxxy/desktop-ui';

describe('Modal layout', () => {
  it('keeps the dialog inside the viewport and scrolls only its body', () => {
    const onClose = vi.fn();
    render(
      <Modal title="Tall dialog" width={760} onClose={onClose}>
        <div style={{ height: 1_200 }}>Long content</div>
        <ModalFooter>
          <Button>Done</Button>
        </ModalFooter>
      </Modal>,
    );

    const dialog = screen.getByRole('dialog');
    const body = dialog.querySelector<HTMLElement>('.moxxy-modal__body');
    const footer = dialog.querySelector<HTMLElement>('.moxxy-modal__footer');

    expect(dialog.style.maxHeight).toBe(
      'calc(100dvh - var(--space-32, 32px))',
    );
    expect(dialog.style.overflow).toBe('hidden');
    expect(body?.style.minHeight).toBe('0');
    expect(body?.style.overflowY).toBe('auto');
    expect(footer?.style.borderTop).toContain('var(--color-card-border)');

    const backdrop = dialog.parentElement;
    expect(backdrop).toHaveClass('moxxy-modal-backdrop');
    if (!backdrop) throw new Error('modal backdrop is required');
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
