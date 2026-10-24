/**
 * Transcription card in Settings → Voice — picks where speech becomes text for
 * the chat microphone and Voice Mode's Local engine: in the cloud over the
 * ChatGPT login, or with Whisper turbo on this computer. The first switch to
 * Local asks before it downloads the model, then shows the download with a way
 * to stop it. Render-only; IPC and the switch's lifecycle live in
 * `useTranscriptionSettings`.
 */

import type { TranscriptionMode, TranscriptionSetup } from '@moxxy/desktop-ipc-contract';
import { Button, ConfirmModal } from '@moxxy/desktop-ui';
import { Segmented } from '../shell/Segmented';
import type { TranscriptionSettingsState } from './useTranscriptionSettings';

const MODE_OPTIONS: ReadonlyArray<{ id: TranscriptionMode; label: string }> = [
  { id: 'cloud', label: 'Cloud' },
  { id: 'local', label: 'Local' },
];
const ALL_MODES: ReadonlyArray<TranscriptionMode> = MODE_OPTIONS.map((option) => option.id);

const MODE_DETAIL: Readonly<Record<TranscriptionMode, string>> = {
  cloud: 'Your speech is transcribed by OpenAI over your ChatGPT login.',
  local: 'Whisper turbo runs on this computer: your speech never leaves it, and transcription works offline.',
};

const LOCAL_TRANSCRIBER = 'local-whisper';
const NOTE_STYLE = { fontSize: 'var(--type-meta)', color: 'var(--color-text-dim)' } as const;

function megabytes(bytes: number): number {
  return Math.round(bytes / 1_000_000);
}

function gigabytes(bytes: number): string {
  return (bytes / 1_000_000_000).toFixed(1);
}

export function TranscriptionSection({
  transcription,
}: {
  readonly transcription: TranscriptionSettingsState;
}): JSX.Element {
  const { loading, mode, active, setup, switching, error, choose } = transcription;
  const localNotRunning = !loading && !switching && mode === 'local' && active !== LOCAL_TRANSCRIBER;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '13px 16px',
        background: 'var(--color-card-bg)',
        border: '1px solid var(--color-card-border)',
        borderRadius: 'var(--radius-card)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
        <div style={{ fontSize: 'var(--type-ui)', fontWeight: 600 }}>Transcription</div>
        <Segmented
          items={MODE_OPTIONS}
          value={loading ? null : switching ?? mode}
          onChange={(next) => void choose(next)}
          testIdPrefix="transcription-"
          disabledIds={loading || switching ? ALL_MODES : undefined}
        />
      </div>
      <div style={{ fontSize: 'var(--type-meta)', color: 'var(--color-text-muted)' }}>
        {MODE_DETAIL[switching ?? mode]}
      </div>
      {setup ? (
        <SetupProgress setup={setup} onCancel={() => void transcription.cancel()} />
      ) : (
        switching === 'cloud' && <div role="status" style={NOTE_STYLE}>Switching to Cloud…</div>
      )}
      {localNotRunning && (
        <div role="status" style={NOTE_STYLE}>
          Local is selected but not running yet. Restart Moxxy, or switch to Cloud.
        </div>
      )}
      {error && (
        <div role="alert" style={{ fontSize: 'var(--type-meta)', color: 'var(--color-red)' }}>{error}</div>
      )}
      {transcription.confirmingDownload && (
        <ConfirmModal
          title="Download Whisper turbo?"
          message={`Local transcription needs the Whisper turbo model on this computer. Moxxy downloads it once (about ${gigabytes(transcription.modelBytes)} GB); after that your speech is turned into text here, even offline. You can keep using Moxxy while it downloads.`}
          confirmLabel="Download"
          cancelLabel="Not now"
          onConfirm={() => void transcription.confirmDownload()}
          onCancel={transcription.dismissDownload}
        />
      )}
    </div>
  );
}

function SetupProgress({
  setup,
  onCancel,
}: {
  readonly setup: TranscriptionSetup;
  readonly onCancel: () => void;
}): JSX.Element {
  if (setup.phase === 'starting') {
    return <div role="status" style={NOTE_STYLE}>Starting local transcription…</div>;
  }
  const percent = setup.totalBytes > 0 ? Math.floor((setup.receivedBytes / setup.totalBytes) * 100) : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        role="progressbar"
        aria-label="Downloading Whisper turbo"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="setup-progress"
      >
        <div className="setup-progress__fill" style={{ transform: `scaleX(${percent / 100})` }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, ...NOTE_STYLE }}>
        <span>
          Downloading Whisper turbo · <span>{`${megabytes(setup.receivedBytes)} of ${megabytes(setup.totalBytes)} MB`}</span>
        </span>
        <Button variant="ghost" size="sm" aria-label="Cancel download" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
