import type { ReactNode } from 'react';
import type { VoiceCallPhase } from '@moxxy/client-core';
import { Button, Icon } from '@moxxy/desktop-ui';
import type { VoiceModeStatus } from './useVoiceModePresentation';
import type { VoiceOrbitView } from './voice-orbit';
import { VoiceControlDock } from './VoiceControlDock';
import { VoicePresenceStage } from './VoicePresenceStage';
import './voice-call.css';

export function VoiceCallSurface({
  phase,
  status,
  orbit,
  microphoneMuted,
  waitingSoundEnabled,
  localPiperInstallRequired,
  localPiperInstalling,
  errorReason,
  inputAnalyser,
  outputAnalyser,
  conversation,
  request,
  onClose,
  onEnterFocusMode,
  onRetry,
  onInstallLocalPiper,
  onMuteMicrophone,
  onUnmuteMicrophone,
  onToggleWaitingSound,
}: {
  readonly phase: VoiceCallPhase;
  readonly status: VoiceModeStatus;
  readonly orbit: VoiceOrbitView;
  readonly microphoneMuted: boolean;
  readonly waitingSoundEnabled: boolean;
  readonly localPiperInstallRequired: boolean;
  readonly localPiperInstalling: boolean;
  readonly errorReason: string | null;
  readonly inputAnalyser: unknown | null;
  readonly outputAnalyser: unknown | null;
  readonly conversation: ReactNode;
  readonly request?: ReactNode;
  readonly onClose: () => void;
  readonly onEnterFocusMode: () => void;
  readonly onRetry: () => void;
  readonly onInstallLocalPiper: () => void;
  readonly onMuteMicrophone: () => void;
  readonly onUnmuteMicrophone: () => void;
  readonly onToggleWaitingSound: () => void;
}): JSX.Element {
  return (
    <div className="voice-call-surface">
      <header className="voice-call-header">
        <Button variant="ghost" className="voice-call-back" aria-label="Back to chat" onClick={onClose}>
          <Icon name="chevron-right" size={17} />
          <span>Back to chat</span>
        </Button>
        <div className="voice-call-title">
          <span>Voice conversation</span>
          <small>Local Piper</small>
        </div>
        <div className="voice-call-header-actions">
          <Button variant="ghost" className="voice-call-focus" aria-label="Open focus mode" onClick={onEnterFocusMode}>
            <Icon name="focus" size={16} />
            <span>Focus mode</span>
          </Button>
          <Button variant="ghost" className="voice-call-end" aria-label="End call" onClick={onClose}>
            <Icon name="x" size={16} />
            <span>End call</span>
          </Button>
        </div>
      </header>

      <main className="voice-call-content">
        <VoicePresenceStage
          phase={phase}
          status={status}
          orbit={orbit}
          microphoneMuted={microphoneMuted}
          inputAnalyser={inputAnalyser}
          outputAnalyser={outputAnalyser}
        />

        <section className="voice-call-conversation" aria-label="Voice conversation transcript">
          {conversation}
        </section>
        {request && <div className="voice-call-request">{request}</div>}
      </main>
      <VoiceControlDock
        microphoneMuted={microphoneMuted}
        waitingSoundEnabled={waitingSoundEnabled}
        localPiperInstallRequired={localPiperInstallRequired}
        localPiperInstalling={localPiperInstalling}
        errorReason={phase === 'error' ? (errorReason ?? 'Voice mode could not continue.') : null}
        onRetry={onRetry}
        onInstallLocalPiper={onInstallLocalPiper}
        onMuteMicrophone={onMuteMicrophone}
        onUnmuteMicrophone={onUnmuteMicrophone}
        onToggleWaitingSound={onToggleWaitingSound}
      />
    </div>
  );
}
