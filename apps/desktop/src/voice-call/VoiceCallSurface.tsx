import type { VoiceCallPhase } from '@moxxy/client-core';
import { Icon } from '@moxxy/desktop-ui';
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
  'waiting-for-input': { title: 'Needs your input', detail: 'Answer the request to continue' },
  synthesizing: { title: 'Preparing voice', detail: 'Local Piper is generating the next sentence' },
  speaking: { title: 'Speaking', detail: 'The microphone will return when the answer ends' },
  paused: { title: 'Paused', detail: 'Resume when you are ready to continue' },
  error: { title: 'Voice mode stopped', detail: 'Resolve the issue and try again' },
};

export function VoiceCallSurface({
  phase,
  errorReason,
  inputAnalyser,
  outputAnalyser,
  lines,
  onClose,
  onRetry,
  onPause,
  onResume,
}: {
  readonly phase: VoiceCallPhase;
  readonly errorReason: string | null;
  readonly inputAnalyser: unknown | null;
  readonly outputAnalyser: unknown | null;
  readonly lines: ReadonlyArray<VoiceTranscriptLine>;
  readonly onClose: () => void;
  readonly onRetry: () => void;
  readonly onPause: () => void;
  readonly onResume: () => void;
}): JSX.Element {
  const status = STATUS[phase];
  return (
    <div className="voice-call-surface">
      <header className="voice-call-header">
        <button type="button" className="voice-call-back" aria-label="Back to chat" onClick={onClose}>
          <Icon name="chevron-right" size={17} />
          <span>Back to chat</span>
        </button>
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

        <VoiceOrb
          phase={phase}
          inputAnalyser={inputAnalyser}
          outputAnalyser={outputAnalyser}
        />

        {phase === 'error' ? (
          <div className="voice-call-error" role="alert">
            <p>{errorReason ?? 'Voice mode could not continue.'}</p>
            <button type="button" onClick={onRetry} aria-label="Try again">
              <Icon name="rotate" size={16} />
              <span>Try again</span>
            </button>
          </div>
        ) : (
          <div className="voice-call-primary-control">
            {phase === 'listening' && (
              <button type="button" onClick={onPause} aria-label="Pause listening">
                <Icon name="mic" size={17} />
                <span>Pause listening</span>
              </button>
            )}
            {phase === 'paused' && (
              <button type="button" onClick={onResume} aria-label="Resume listening">
                <Icon name="mic" size={17} />
                <span>Resume listening</span>
              </button>
            )}
          </div>
        )}

        <VoiceTranscript lines={lines} />
      </section>
    </div>
  );
}
