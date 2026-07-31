import type { VoiceCallPhase, VoiceToolActivity } from '@moxxy/client-core';
import { Button, Icon } from '@moxxy/desktop-ui';
import { VoiceActivityIndicator } from './VoiceActivityIndicator';
import { VoiceAvatar } from './VoiceAvatar';
import { VoiceTranscript } from './VoiceTranscript';
import type { VoiceTranscriptLine } from './voice-transcript';
import './voice-call.css';

const STATUS: Record<VoiceCallPhase, { readonly title: string; readonly detail: string }> = {
  idle: { title: 'Voice mode', detail: 'Ready to start' },
  checking: { title: 'Preparing', detail: 'Checking microphone and Local Piper' },
  arming: { title: 'Preparing microphone', detail: 'The microphone will be ready in a moment' },
  listening: { title: 'Listening', detail: 'Speak naturally. I will answer when you finish.' },
  transcribing: { title: 'Transcribing', detail: 'Turning your voice into text' },
  thinking: { title: 'Thinking', detail: 'Using the context from this conversation' },
  working: { title: 'Working', detail: 'I will keep you updated while the task continues' },
  'waiting-for-input': { title: 'Needs your input', detail: 'Answer the request to continue' },
  synthesizing: { title: 'Preparing voice', detail: 'Local Piper is generating the next sentence' },
  speaking: { title: 'Speaking', detail: 'Speak at any time to interrupt' },
  paused: { title: 'Microphone off', detail: 'Moxxy will not listen until you turn it back on' },
  error: { title: 'Voice mode stopped', detail: 'Resolve the issue and try again' },
};

const MUTED_SPEAKING_STATUS = {
  title: STATUS.speaking.title,
  detail: 'The microphone will stay off after this answer',
} as const;

export function VoiceCallSurface({
  phase,
  activity,
  microphoneMuted,
  waitingSoundEnabled,
  localPiperInstallRequired,
  localPiperInstalling,
  errorReason,
  inputAnalyser,
  outputAnalyser,
  lines,
  onClose,
  onEnterFocusMode,
  onRetry,
  onInstallLocalPiper,
  onMuteMicrophone,
  onUnmuteMicrophone,
  onToggleWaitingSound,
}: {
  readonly phase: VoiceCallPhase;
  readonly activity: VoiceToolActivity | null;
  readonly microphoneMuted: boolean;
  readonly waitingSoundEnabled: boolean;
  readonly localPiperInstallRequired: boolean;
  readonly localPiperInstalling: boolean;
  readonly errorReason: string | null;
  readonly inputAnalyser: unknown | null;
  readonly outputAnalyser: unknown | null;
  readonly lines: ReadonlyArray<VoiceTranscriptLine>;
  readonly onClose: () => void;
  readonly onEnterFocusMode: () => void;
  readonly onRetry: () => void;
  readonly onInstallLocalPiper: () => void;
  readonly onMuteMicrophone: () => void;
  readonly onUnmuteMicrophone: () => void;
  readonly onToggleWaitingSound: () => void;
}): JSX.Element {
  const status = localPiperInstallRequired
    ? localPiperInstalling
      ? {
          title: 'Installing local voice',
          detail: 'Downloading the offline voice package',
        }
      : {
          title: 'Local voice required',
          detail: 'Install Local Piper once to use Voice Mode',
        }
    : phase === 'speaking' && microphoneMuted
      ? MUTED_SPEAKING_STATUS
      : STATUS[phase];
  return (
    <div className="voice-call-surface">
      <header className="voice-call-header">
        <div className="voice-call-header-actions">
          <Button
            variant="ghost"
            className="voice-call-back"
            aria-label="Back to chat"
            onClick={onClose}
          >
            <Icon name="chevron-right" size={17} />
            <span>Back to chat</span>
          </Button>
          <Button
            variant="ghost"
            className="voice-call-focus"
            aria-label="Open focus mode"
            onClick={onEnterFocusMode}
            style={{ color: 'var(--color-primary)' }}
          >
            <Icon name="focus" size={16} />
            <span>Focus mode</span>
          </Button>
        </div>
        <div className="voice-call-title">
          <span>Voice conversation</span>
          <small>Local Piper</small>
        </div>
        <Button
          variant="ghost"
          className="voice-call-end"
          onClick={onClose}
          style={{ color: 'var(--color-red-text)' }}
        >
          <Icon name="x" size={16} />
          <span>End call</span>
        </Button>
      </header>

      <section className="voice-call-stage">
        <div className="voice-call-status" role="status" aria-live="polite">
          <h1>{status.title}</h1>
          <p>{status.detail}</p>
        </div>

        <div className="voice-call-core">
          <VoiceAvatar
            phase={phase}
            microphoneMuted={microphoneMuted}
            inputAnalyser={inputAnalyser}
            outputAnalyser={outputAnalyser}
          />
          {activity && <VoiceActivityIndicator activity={activity} />}
        </div>

        {phase === 'error' && localPiperInstallRequired ? (
          <div className="voice-call-install" role="alert">
            <span className="voice-call-install-icon" aria-hidden="true">
              <Icon name="plug" size={18} />
            </span>
            <div className="voice-call-install-copy">
              <strong>Local Piper</strong>
              <p>
                Voice Mode uses an offline voice that runs privately on this computer.
                Install it once, then Moxxy will prepare Polish and English voices when needed.
              </p>
              {errorReason && errorReason !== 'Local Piper is not installed.' && (
                <small>{errorReason}</small>
              )}
            </div>
            <button
              type="button"
              onClick={onInstallLocalPiper}
              disabled={localPiperInstalling}
              aria-label={localPiperInstalling ? 'Installing Local Piper' : 'Install Local Piper'}
            >
              <Icon name={localPiperInstalling ? 'rotate' : 'plug'} size={16} />
              <span>{localPiperInstalling ? 'Installing…' : 'Install Local Piper'}</span>
            </button>
          </div>
        ) : phase === 'error' ? (
          <div className="voice-call-error" role="alert">
            <p>{errorReason ?? 'Voice mode could not continue.'}</p>
            <button type="button" onClick={onRetry} aria-label="Try again">
              <Icon name="rotate" size={16} />
              <span>Try again</span>
            </button>
          </div>
        ) : (
          <div className="voice-call-primary-control" aria-label="Voice controls">
            <button
              type="button"
              className={microphoneMuted ? 'is-muted' : undefined}
              onClick={microphoneMuted ? onUnmuteMicrophone : onMuteMicrophone}
              aria-label={microphoneMuted ? 'Unmute microphone' : 'Mute microphone'}
              aria-pressed={microphoneMuted}
            >
              <span className={`voice-call-mic-icon${microphoneMuted ? ' is-muted' : ''}`}>
                <Icon name="mic" size={17} />
              </span>
              <span>{microphoneMuted ? 'Turn microphone on' : 'Mute microphone'}</span>
            </button>
            <button
              type="button"
              className={waitingSoundEnabled ? undefined : 'is-muted'}
              onClick={onToggleWaitingSound}
              aria-label={waitingSoundEnabled ? 'Turn waiting sound off' : 'Turn waiting sound on'}
              aria-pressed={waitingSoundEnabled}
            >
              <span className={`voice-call-sound-icon${waitingSoundEnabled ? '' : ' is-muted'}`}>
                <Icon name="speaker" size={17} />
              </span>
              <span>{waitingSoundEnabled ? 'Waiting sound on' : 'Waiting sound off'}</span>
            </button>
          </div>
        )}

        <VoiceTranscript lines={lines} />
      </section>
    </div>
  );
}
