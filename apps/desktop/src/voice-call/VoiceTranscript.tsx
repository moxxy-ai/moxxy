import type { VoiceTranscriptLine } from './voice-transcript';

export function VoiceTranscript({
  lines,
}: {
  readonly lines: ReadonlyArray<VoiceTranscriptLine>;
}): JSX.Element {
  if (lines.length === 0) {
    return (
      <p className="voice-call-transcript-empty">
        Start speaking when the core begins listening.
      </p>
    );
  }
  return (
    <div className="voice-call-transcript" aria-label="Voice conversation transcript">
      {lines.map((line, index) => (
        <div
          className={`voice-call-line voice-call-line--${line.role}`}
          key={`${line.role}-${index}-${line.text.slice(0, 24)}`}
        >
          <span className="voice-call-line-role">
            {line.role === 'user' ? 'You' : 'Moxxy'}
          </span>
          <p className={line.streaming ? 'voice-call-line-text is-streaming' : 'voice-call-line-text'}>
            {line.text}
          </p>
        </div>
      ))}
    </div>
  );
}
