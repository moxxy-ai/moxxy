import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { VoiceCallSurface } from './VoiceCallSurface';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('VoiceCallSurface', () => {
  it('renders the listening state, quiet transcript and call controls', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const onClose = vi.fn();
    const onPause = vi.fn();
    const { container } = render(
      <VoiceCallSurface
        phase="listening"
        errorReason={null}
        inputAnalyser={null}
        outputAnalyser={null}
        lines={[
          { role: 'user', text: 'Opowiedz mi o kawie', streaming: false },
          { role: 'assistant', text: 'Najpierw zmiel świeże ziarna.', streaming: false },
        ]}
        onClose={onClose}
        onRetry={vi.fn()}
        onPause={onPause}
        onResume={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Listening');
    expect(screen.getByText('Opowiedz mi o kawie')).toBeInTheDocument();
    expect(screen.getByText('Najpierw zmiel świeże ziarna.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pause listening' }));
    expect(onPause).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Back to chat' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toMatch(/[—–]/u);
  });

  it('offers retry for a visible Piper error', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const onRetry = vi.fn();
    render(
      <VoiceCallSurface
        phase="error"
        errorReason="Local Piper is not active."
        inputAnalyser={null}
        outputAnalyser={null}
        lines={[]}
        onClose={vi.fn()}
        onRetry={onRetry}
        onPause={vi.fn()}
        onResume={vi.fn()}
      />,
    );

    expect(screen.getByText('Local Piper is not active.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
