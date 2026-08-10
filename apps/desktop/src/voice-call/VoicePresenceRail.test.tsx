import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VoicePresenceRail } from './VoicePresenceRail';
import type { VoiceRailView } from './voice-rail';

const EMPTY_RAIL: VoiceRailView = { operation: null, overflowCount: 0, nextExpiry: null };

function renderRail(overrides: Partial<Parameters<typeof VoicePresenceRail>[0]> = {}) {
  const handlers = {
    onRetry: vi.fn(),
    onInstallLocalPiper: vi.fn(),
    onMuteMicrophone: vi.fn(),
    onUnmuteMicrophone: vi.fn(),
    onToggleWaitingSound: vi.fn(),
    onClose: vi.fn(),
  };
  const view = render(
    <VoicePresenceRail
      phase="listening"
      status={{ title: 'Listening', detail: 'Speak naturally. You can still type.' }}
      rail={EMPTY_RAIL}
      microphoneMuted={false}
      waitingSoundEnabled
      localPiperInstallRequired={false}
      localPiperInstalling={false}
      errorReason={null}
      inputAnalyser={null}
      outputAnalyser={null}
      {...handlers}
      {...overrides}
    />,
  );
  return { ...view, ...handlers };
}

describe('VoicePresenceRail', () => {
  it('announces the phase and keeps every control reachable by name', () => {
    const { onMuteMicrophone, onToggleWaitingSound, onClose } = renderRail();

    expect(screen.getByRole('status')).toHaveTextContent('Listening');
    expect(screen.getByText('Speak naturally. You can still type.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Turn the microphone off' }));
    fireEvent.click(screen.getByRole('button', { name: 'Turn the waiting sound off' }));
    fireEvent.click(screen.getByRole('button', { name: 'End voice mode' }));
    expect(onMuteMicrophone).toHaveBeenCalledTimes(1);
    expect(onToggleWaitingSound).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('offers to unmute once the microphone is off, and says so', () => {
    const { onUnmuteMicrophone } = renderRail({ microphoneMuted: true });

    const control = screen.getByRole('button', { name: 'Turn the microphone on' });
    expect(control).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(control);
    expect(onUnmuteMicrophone).toHaveBeenCalledTimes(1);
  });

  it('shows one operation with the others counted, and never its input', () => {
    renderRail({
      rail: {
        operation: {
          callId: 'a',
          kind: 'command',
          label: 'Running commands',
          slot: 0,
          state: 'running',
        },
        overflowCount: 2,
        nextExpiry: null,
      },
    });

    const operation = screen.getByTestId('voice-rail-operation');
    expect(operation).toHaveTextContent('Running commands');
    expect(operation).toHaveTextContent('IN PROGRESS');
    expect(operation).toHaveTextContent('+2 active');
    expect(operation.textContent).not.toMatch(/--|\/|npm|rm /);
  });

  it('keeps the work slot occupied while nothing is running', () => {
    renderRail();

    expect(screen.getByTestId('voice-rail-idle')).toHaveTextContent('No tools running');
    expect(screen.queryByTestId('voice-rail-operation')).toBeNull();
  });

  it('gives the idle slot up the moment an operation arrives', () => {
    renderRail({
      rail: {
        operation: { callId: 'a', kind: 'web-search', label: 'Searching the web', slot: 0, state: 'running' },
        overflowCount: 0,
        nextExpiry: null,
      },
    });

    expect(screen.queryByTestId('voice-rail-idle')).toBeNull();
    expect(screen.getByTestId('voice-rail-operation')).toHaveTextContent('Searching the web');
  });

  it('activates the waves only while a voice is carrying', () => {
    for (const phase of ['listening', 'speaking'] as const) {
      const { container, unmount } = renderRail({ phase });
      const waves = Array.from(container.querySelectorAll('.voice-radio-waves'));
      expect(waves.every((wave) => wave.getAttribute('data-active') === 'true')).toBe(true);
      unmount();
    }
    for (const phase of ['thinking', 'transcribing', 'synthesizing'] as const) {
      const { container, unmount } = renderRail({ phase });
      const waves = Array.from(container.querySelectorAll('.voice-radio-waves'));
      expect(waves.every((wave) => wave.getAttribute('data-active') === 'false')).toBe(true);
      unmount();
    }
  });

  it('lays the waves out beside the mark, never on top of the status text', () => {
    const { container } = renderRail();

    const waves = Array.from(container.querySelectorAll('.voice-radio-waves'));
    expect(waves).toHaveLength(2);
    // Overlaying them on the mark is what let them land on the copy. Being
    // siblings inside the presence row means the layout reserves their space.
    for (const wave of waves) {
      expect(wave.closest('.voice-rail-mark')).toBeNull();
      expect(wave.parentElement).toHaveClass('voice-rail-presence');
    }
  });

  it('replaces the work slot with the install prompt when Local Piper is missing', () => {
    const { onInstallLocalPiper } = renderRail({ localPiperInstallRequired: true });

    fireEvent.click(screen.getByRole('button', { name: /install local piper/i }));
    expect(onInstallLocalPiper).toHaveBeenCalledTimes(1);
    // Ending the call stays available even when the voice cannot start.
    expect(screen.getByRole('button', { name: 'End voice mode' })).toBeInTheDocument();
  });

  it('shows the failure reason with retry, and still lets the call be ended', () => {
    const { onRetry } = renderRail({ phase: 'error', errorReason: 'Piper stopped responding.' });

    expect(screen.getByText('Piper stopped responding.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'End voice mode' })).toBeInTheDocument();
  });

  it('paints no canvas — the rail is vector and CSS only', () => {
    const { container } = renderRail();

    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
