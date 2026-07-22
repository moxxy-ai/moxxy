import type { VoiceCallPhase, VoiceToolActivity } from '@moxxy/client-core';
import { Icon } from '@moxxy/desktop-ui';
import { VoiceActivityIndicator } from './VoiceActivityIndicator';
import { VoiceOrb } from './VoiceOrb';
import { VoiceTranscript } from './VoiceTranscript';
import type { VoiceTranscriptLine } from './voice-transcript';
import './voice-call.css';

const STATUS: Record<VoiceCallPhase, { readonly title: string; readonly detail: string }> = {
  idle: { title: 'Voice mode', detail: 'Ready to start' },
  checking: { title: 'Preparing', detail: 'Checking microphone and Local Piper' },
  listening: { title: 'Listening', detail: 'Speak naturally. I will answer when you finish.' },
  transcribing: { title: 'Transcribing', detail: 'Turning your voice into text' },
  thinking: { title: 'Thinking', detail: 'Using the context from this conversation' },
  working: { title: 'Working', detail: 'I will keep you updated while the task continues' },
  'waiting-for-input': { title: 'Needs your input', detail: 'Answer the request to continue' },
  synthesizing: { title: 'Preparing voice', detail: 'Local Piper is generating the next sentence' },
  speaking: { title: 'Speaking', detail: 'The microphone will return when the answer ends' },
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
  errorReason,
  inputAnalyser,
  outputAnalyser,
  lines,
  onClose,
  onEnterFocusMode,
  onRetry,
  onMuteMicrophone,
  onUnmuteMicrophone,
  onToggleWaitingSound,
}: {
  readonly phase: VoiceCallPhase;
  readonly activity: VoiceToolActivity | null;
  readonly microphoneMuted: boolean;
  readonly waitingSoundEnabled: boolean;
  readonly errorReason: string | null;
  readonly inputAnalyser: unknown | null;
  readonly outputAnalyser: unknown | null;
  readonly lines: ReadonlyArray<VoiceTranscriptLine>;
  readonly onClose: () => void;
  readonly onEnterFocusMode: () => void;
  readonly onRetry: () => void;
  readonly onMuteMicrophone: () => void;
  readonly onUnmuteMicrophone: () => void;
  readonly onToggleWaitingSound: () => void;
}): JSX.Element {
  const status = phase === 'speaking' && microphoneMuted
    ? MUTED_SPEAKING_STATUS
    : STATUS[phase];
  return (
    <div className="voice-call-surface">
      <header className="voice-call-header">
        <div className="voice-call-header-actions">
          <button type="button" className="voice-call-back" aria-label="Back to chat" onClick={onClose}>
            <Icon name="chevron-right" size={17} />
            <span>Back to chat</span>
          </button>
          <button
            type="button"
            className="voice-call-focus"
            aria-label="Open focus mode"
            onClick={onEnterFocusMode}
          >
            <Icon name="focus" size={16} />
            <span>Focus mode</span>
          </button>
        </div>
        <div className="voice-call-title">
          <span>Voice conversation</span>
          <small>Local Piper</small>
        </div>
        <button type="button" className="voice-call-end" onClick={onClose}>
          <Icon name="x" size={16} />
          <span>End call</span>
        </button>
      </header>

      <section className="voice-call-stage">
        <div className="voice-call-status" role="status" aria-live="polite">
          <h1>{status.title}</h1>
          <p>{status.detail}</p>
        </div>

        <div className="voice-call-core">
          <VoiceOrb
            phase={phase}
            microphoneMuted={microphoneMuted}
            inputAnalyser={inputAnalyser}
            outputAnalyser={outputAnalyser}
          />
          {activity && <VoiceActivityIndicator activity={activity} />}
        </div>

        {phase === 'error' ? (
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
