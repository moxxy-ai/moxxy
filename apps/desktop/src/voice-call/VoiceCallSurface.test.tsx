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
    const onEnterFocusMode = vi.fn();
    const onMuteMicrophone = vi.fn();
    const { container } = render(
      <VoiceCallSurface
        phase="listening"
        activity={null}
        microphoneMuted={false}
        waitingSoundEnabled
        errorReason={null}
        inputAnalyser={null}
        outputAnalyser={null}
        lines={[
          { role: 'user', text: 'Opowiedz mi o kawie', streaming: false },
          { role: 'assistant', text: 'Najpierw zmiel świeże ziarna.', streaming: false },
        ]}
        onClose={onClose}
        onEnterFocusMode={onEnterFocusMode}
        onRetry={vi.fn()}
        onMuteMicrophone={onMuteMicrophone}
        onUnmuteMicrophone={vi.fn()}
        onToggleWaitingSound={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Listening');
    expect(screen.getByText('Opowiedz mi o kawie')).toBeInTheDocument();
    expect(screen.getByText('Najpierw zmiel świeże ziarna.')).toBeInTheDocument();
    const muteButton = screen.getByRole('button', { name: 'Mute microphone' });
    expect(muteButton).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(muteButton);
    expect(onMuteMicrophone).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Back to chat' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Open focus mode' }));
    expect(onEnterFocusMode).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toMatch(/[—–]/u);
  });

  it('keeps the microphone control available while speaking and exposes the muted state', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const onUnmuteMicrophone = vi.fn();
    render(
      <VoiceCallSurface
        phase="speaking"
        activity={null}
        microphoneMuted
        waitingSoundEnabled
        errorReason={null}
        inputAnalyser={null}
        outputAnalyser={null}
        lines={[]}
        onClose={vi.fn()}
        onEnterFocusMode={vi.fn()}
        onRetry={vi.fn()}
        onMuteMicrophone={vi.fn()}
        onUnmuteMicrophone={onUnmuteMicrophone}
        onToggleWaitingSound={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Speaking');
    expect(screen.getByRole('status')).toHaveTextContent(
      'The microphone will stay off after this answer',
    );
    const unmuteButton = screen.getByRole('button', { name: 'Unmute microphone' });
    expect(unmuteButton).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(unmuteButton);
    expect(onUnmuteMicrophone).toHaveBeenCalledTimes(1);
  });

  it('offers retry for a visible Piper error', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const onRetry = vi.fn();
    render(
      <VoiceCallSurface
        phase="error"
        activity={null}
        microphoneMuted={false}
        waitingSoundEnabled
        errorReason="Local Piper is not active."
        inputAnalyser={null}
        outputAnalyser={null}
        lines={[]}
        onClose={vi.fn()}
        onEnterFocusMode={vi.fn()}
        onRetry={onRetry}
        onMuteMicrophone={vi.fn()}
        onUnmuteMicrophone={vi.fn()}
        onToggleWaitingSound={vi.fn()}
      />,
    );

    expect(screen.getByText('Local Piper is not active.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders an explicit working state between spoken updates', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    render(
      <VoiceCallSurface
        phase="working"
        activity="editing"
        microphoneMuted={false}
        waitingSoundEnabled
        errorReason={null}
        inputAnalyser={null}
        outputAnalyser={null}
        lines={[]}
        onClose={vi.fn()}
        onEnterFocusMode={vi.fn()}
        onRetry={vi.fn()}
        onMuteMicrophone={vi.fn()}
        onUnmuteMicrophone={vi.fn()}
        onToggleWaitingSound={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Working');
    expect(screen.getByRole('status')).toHaveTextContent('I will keep you updated');
    expect(screen.getByLabelText('Current activity')).toHaveTextContent('Writing changes');
    expect(screen.getByLabelText('Current activity')).toHaveTextContent('In progress');
  });

  it('exposes a quiet, accessible switch for the waiting sound', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const onToggleWaitingSound = vi.fn();
    render(
      <VoiceCallSurface
        phase="thinking"
        activity={null}
        microphoneMuted={false}
        waitingSoundEnabled={false}
        errorReason={null}
        inputAnalyser={null}
        outputAnalyser={null}
        lines={[]}
        onClose={vi.fn()}
        onEnterFocusMode={vi.fn()}
        onRetry={vi.fn()}
        onMuteMicrophone={vi.fn()}
        onUnmuteMicrophone={vi.fn()}
        onToggleWaitingSound={onToggleWaitingSound}
      />,
    );

    const soundButton = screen.getByRole('button', { name: 'Turn waiting sound on' });
    expect(soundButton).toHaveAttribute('aria-pressed', 'false');
    expect(soundButton).toHaveTextContent('Waiting sound off');
    fireEvent.click(soundButton);
    expect(onToggleWaitingSound).toHaveBeenCalledTimes(1);
  });
});
