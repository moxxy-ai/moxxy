import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastStack } from './ToastStack';

afterEach(cleanup);

describe('ToastStack', () => {
  it('announces each toast with its title and words', () => {
    render(
      <ToastStack
        toasts={[{ id: 'a', tone: 'success', title: 'Local transcription is ready', body: 'Whisper turbo runs here now.' }]}
        onDismiss={vi.fn()}
      />,
    );

    const stack = screen.getByRole('status');
    expect(stack.textContent).toContain('Local transcription is ready');
    expect(stack.textContent).toContain('Whisper turbo runs here now.');
  });

  it('opens what a toast is about and dismisses it', () => {
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    render(<ToastStack toasts={[{ id: 'chat:b', tone: 'info', title: 'Chat b', onOpen }]} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: /Chat b/ }));

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledWith('chat:b');
  });

  it('closes a toast without opening anything', () => {
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    render(<ToastStack toasts={[{ id: 'chat:b', tone: 'info', title: 'Chat b', onOpen }]} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(onOpen).not.toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalledWith('chat:b');
  });

  it('renders nothing to click on a toast with nowhere to go', () => {
    render(<ToastStack toasts={[{ id: 'x', tone: 'error', title: 'Failed' }]} onDismiss={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /Failed/ })).toBeNull();
    expect(screen.getByText('Failed')).toBeTruthy();
  });
});
