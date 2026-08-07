import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { VoiceCallSurface } from './VoiceCallSurface';
import type { VoiceOrbitView } from './voice-orbit';

afterEach(() => vi.restoreAllMocks());

const EMPTY_ORBIT: VoiceOrbitView = Object.freeze({
  items: Object.freeze([]),
  overflowCount: 0,
  nextExpiry: null,
});

function props(overrides: Partial<Parameters<typeof VoiceCallSurface>[0]> = {}) {
  return {
    phase: 'listening' as const,
    status: { title: 'Listening', detail: 'Speak naturally.' },
    orbit: EMPTY_ORBIT,
    microphoneMuted: false,
    waitingSoundEnabled: true,
    localPiperInstallRequired: false,
    localPiperInstalling: false,
    errorReason: null,
    inputAnalyser: null,
    outputAnalyser: null,
    conversation: <div>Full formatted conversation</div>,
    onClose: vi.fn(),
    onEnterFocusMode: vi.fn(),
    onRetry: vi.fn(),
    onInstallLocalPiper: vi.fn(),
    onMuteMicrophone: vi.fn(),
    onUnmuteMicrophone: vi.fn(),
    onToggleWaitingSound: vi.fn(),
    ...overrides,
  };
}

describe('VoiceCallSurface', () => {
  it('renders the dumb presentation model, hologram and full conversation slot', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { container } = render(<VoiceCallSurface {...props()} />);

    expect(screen.getByRole('status')).toHaveTextContent('Listening');
    expect(screen.getByText('Full formatted conversation')).toBeInTheDocument();
    expect(screen.getByTestId('voice-hologram-canvas')).toBeInTheDocument();
    expect(container.querySelector('.voice-avatar')).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/[—–]/u);
  });

  it('integrates the hologram and transcript in one continuous voice surface', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { container } = render(<VoiceCallSurface {...props()} />);
    const content = container.querySelector<HTMLElement>('.voice-call-content');
    const presence = container.querySelector<HTMLElement>('.voice-presence-stage');
    const conversation = container.querySelector<HTMLElement>('.voice-call-conversation');

    if (!content || !presence || !conversation) throw new Error('Integrated voice surface regions are missing');
    expect(content).toContainElement(presence);
    expect(content).toContainElement(conversation);
    expect(presence.parentElement).toBe(content);
    expect(conversation.parentElement).toBe(content);
  });

  it('renders multiple active operations in stable orbit slots', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    render(<VoiceCallSurface {...props({
      phase: 'working',
      status: { title: 'Working', detail: 'Operations remain visible until they finish' },
      orbit: {
        items: [
          { callId: 'web', kind: 'web-search', label: 'Searching the web', slot: 0, state: 'running' },
          { callId: 'edit', kind: 'editing', label: 'Writing changes', slot: 1, state: 'running' },
          { callId: 'test', kind: 'verification', label: 'Running focused tests', slot: 2, state: 'running' },
        ],
        overflowCount: 2,
        nextExpiry: null,
      },
    })} />);

    expect(screen.getByLabelText('Current voice operations')).toHaveTextContent('Searching the web');
    expect(screen.getByLabelText('Current voice operations')).toHaveTextContent('Writing changes');
    expect(screen.getByLabelText('Current voice operations')).toHaveTextContent('Running focused tests');
    expect(screen.getByText('+2 active')).toBeInTheDocument();
  });

  it('keeps navigation and microphone controls wired', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const onClose = vi.fn();
    const onEnterFocusMode = vi.fn();
    const onMuteMicrophone = vi.fn();
    const componentProps = props({ onClose, onEnterFocusMode, onMuteMicrophone });
    render(<VoiceCallSurface {...componentProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Back to chat' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open focus mode' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mute microphone' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onEnterFocusMode).toHaveBeenCalledOnce();
    expect(onMuteMicrophone).toHaveBeenCalledOnce();
  });

  it('exposes muted microphone and waiting sound states', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const onUnmuteMicrophone = vi.fn();
    const onToggleWaitingSound = vi.fn();
    render(<VoiceCallSurface {...props({
      microphoneMuted: true,
      waitingSoundEnabled: false,
      onUnmuteMicrophone,
      onToggleWaitingSound,
    })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Unmute microphone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Turn waiting sound on' }));
    expect(onUnmuteMicrophone).toHaveBeenCalledOnce();
    expect(onToggleWaitingSound).toHaveBeenCalledOnce();
  });

  it('renders the request between conversation and controls', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { container } = render(<VoiceCallSurface {...props({ request: <div>Approval required</div> })} />);
    const conversation = container.querySelector('.voice-call-conversation');
    const request = container.querySelector('.voice-call-request');
    const controls = container.querySelector('.voice-control-dock');
    expect(request).toHaveTextContent('Approval required');
    if (!conversation || !request || !controls) throw new Error('Voice surface regions are missing');
    expect(conversation.compareDocumentPosition(request) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(request.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('offers Local Piper installation and locks it while downloading', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const onInstallLocalPiper = vi.fn();
    const { rerender } = render(<VoiceCallSurface {...props({
      phase: 'error',
      localPiperInstallRequired: true,
      onInstallLocalPiper,
    })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Install Local Piper' }));
    expect(onInstallLocalPiper).toHaveBeenCalledOnce();

    rerender(<VoiceCallSurface {...props({
      phase: 'error',
      localPiperInstallRequired: true,
      localPiperInstalling: true,
    })} />);
    expect(screen.getByRole('button', { name: 'Installing Local Piper' })).toBeDisabled();
  });

  it('offers retry for a call error', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const onRetry = vi.fn();
    render(<VoiceCallSurface {...props({
      phase: 'error',
      errorReason: 'Local Piper is not active.',
      onRetry,
    })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
