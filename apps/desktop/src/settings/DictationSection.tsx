/**
 * Dictation models in Settings → Voice: what turns speech into text for the
 * chat microphone and Voice Mode's Classic engine. Each model is a row with
 * what sets it apart; a local one downloads from its row. Render-only; IPC and
 * the switch's lifecycle live in `useTranscriptionSettings`.
 */

import type { LocalTranscriptionModelId, LocalTranscriptionModelState } from '@moxxy/desktop-ipc-contract';
import { Button, TextInput } from '@moxxy/desktop-ui';
import { Badge, CardGroup, Row } from './settings-primitives';
import type { TranscriptionSettingsState } from './useTranscriptionSettings';
import type { VaultKeyState } from './useVaultKey';

interface LocalModelCopy {
  readonly title: string;
  readonly label: string;
  readonly transcriber: string;
  readonly detail: string;
}

const LOCAL_MODEL_COPY: Readonly<Record<LocalTranscriptionModelId, LocalModelCopy>> = {
  parakeet: {
    title: 'Parakeet TDT 0.6B v3',
    label: 'Parakeet',
    transcriber: 'local-parakeet',
    detail: 'Fast. Detects the spoken language itself, in 25 languages.',
  },
  turbo: {
    title: 'Whisper large-v3 turbo',
    label: 'Whisper turbo',
    transcriber: 'local-whisper',
    detail: 'Slower. Works in about 100 languages.',
  },
};

const NOTE_STYLE = { fontSize: 'var(--type-meta)', color: 'var(--color-text-dim)', marginTop: 6 } as const;

function megabytes(bytes: number): number {
  return Math.round(bytes / 1_000_000);
}

function downloadSize(bytes: number): string {
  return bytes >= 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(1)} GB` : `${megabytes(bytes)} MB`;
}

export function DictationSection({
  transcription,
  openAiKey,
}: {
  readonly transcription: TranscriptionSettingsState;
  readonly openAiKey: VaultKeyState;
}): JSX.Element {
  const { models, choice, loading, switching, error, choose } = transcription;
  const inUse = (
    <Badge>In use</Badge>
  );
  return (
    <CardGroup id="voice-dictation" title="Dictation model">
      {models.map((model) => (
        <LocalModelRow key={model.id} model={model} transcription={transcription} />
      ))}
      <Row
        testId="voice-model-cloud"
        tile={null}
        title="OpenAI"
        subtitle="Runs in the cloud on your OpenAI API key."
        badges={!loading && choice === 'cloud' ? inUse : undefined}
        trailing={!loading && choice !== 'cloud' && (
          <Button variant="secondary" size="sm" disabled={switching !== null} onClick={() => void choose('cloud')}>
            Use
          </Button>
        )}
        below={<OpenAiKeyField openAiKey={openAiKey} showMissing={!loading && choice === 'cloud'} />}
      />
      {error && (
        <li role="alert" style={{ fontSize: 'var(--type-meta)', color: 'var(--color-red)' }}>{error}</li>
      )}
    </CardGroup>
  );
}

function LocalModelRow({
  model,
  transcription,
}: {
  readonly model: LocalTranscriptionModelState;
  readonly transcription: TranscriptionSettingsState;
}): JSX.Element {
  const { active, choice, failed, setup, switching, choose, cancel, remove } = transcription;
  const copy = LOCAL_MODEL_COPY[model.id];
  const chosen = choice === model.id;
  const setupHere = setup?.model === model.id ? setup : null;
  const notRunning = chosen && !switching && active !== copy.transcriber;
  return (
    <Row
      testId={`voice-model-${model.id}`}
      tile={null}
      title={copy.title}
      subtitle={`${copy.detail} Download size: ${downloadSize(model.bytes)}.`}
      badges={chosen ? <Badge>In use</Badge> : undefined}
      trailing={!chosen && !setupHere && (
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {model.ready && (
            <Button variant="ghost" size="sm" disabled={switching !== null} onClick={() => void remove(model.id)}>
              Remove
            </Button>
          )}
          <Button variant="secondary" size="sm" disabled={switching !== null} onClick={() => void choose(model.id)}>
            {failed === model.id ? 'Try again' : model.ready ? 'Use' : 'Download'}
          </Button>
        </div>
      )}
      below={(
        <>
          {setupHere?.phase === 'downloading' && (
            <DownloadProgress
              label={copy.label}
              receivedBytes={setupHere.receivedBytes}
              totalBytes={setupHere.totalBytes}
              onCancel={() => void cancel()}
            />
          )}
          {setupHere?.phase === 'starting' && <div role="status" style={NOTE_STYLE}>Starting {copy.label}…</div>}
          {notRunning && (
            <div role="status" style={NOTE_STYLE}>
              Selected but not running yet. Restart Moxxy, or choose another model.
            </div>
          )}
        </>
      )}
    />
  );
}

function DownloadProgress({
  label,
  receivedBytes,
  totalBytes,
  onCancel,
}: {
  readonly label: string;
  readonly receivedBytes: number;
  readonly totalBytes: number;
  readonly onCancel: () => void;
}): JSX.Element {
  const percent = totalBytes > 0 ? Math.floor((receivedBytes / totalBytes) * 100) : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
      <div
        role="progressbar"
        aria-label={`Downloading ${label}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="setup-progress"
      >
        <div className="setup-progress__fill" style={{ transform: `scaleX(${percent / 100})` }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 'var(--type-meta)', color: 'var(--color-text-dim)' }}>
        <span>{`${megabytes(receivedBytes)} of ${megabytes(totalBytes)} MB`}</span>
        <Button variant="ghost" size="sm" aria-label="Cancel download" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function OpenAiKeyField({
  openAiKey,
  showMissing,
}: {
  readonly openAiKey: VaultKeyState;
  /** Without a key, OpenAI transcription cannot run. */
  readonly showMissing: boolean;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
      <label htmlFor="openai-api-key" style={{ fontSize: 'var(--type-meta)' }}>
        OpenAI API key{openAiKey.hasKey ? ' · key saved in this device vault' : ''}
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <TextInput
          id="openai-api-key"
          type="password"
          value={openAiKey.draft}
          onChange={(event) => openAiKey.setDraft(event.target.value)}
          placeholder={openAiKey.hasKey ? 'Paste a replacement key' : 'Paste your OpenAI API key (sk-…)'}
          autoComplete="off"
          style={{ flex: 1 }}
        />
        <Button
          variant="secondary"
          disabled={openAiKey.busy || !openAiKey.draft.trim()}
          onClick={() => void openAiKey.save()}
        >
          Save OpenAI key
        </Button>
      </div>
      <div style={{ fontSize: 'var(--type-meta)', color: 'var(--color-text-dim)' }}>
        GPT-Live uses this key too. OpenAI bills their use to it, separately from a ChatGPT plan.
      </div>
      {showMissing && !openAiKey.loading && !openAiKey.hasKey && (
        <div role="status" style={NOTE_STYLE}>Add your OpenAI API key to use OpenAI transcription, or choose a local model.</div>
      )}
      {openAiKey.error && (
        <div role="alert" style={{ color: 'var(--color-red)', fontSize: 'var(--type-meta)' }}>{openAiKey.error}</div>
      )}
    </div>
  );
}
