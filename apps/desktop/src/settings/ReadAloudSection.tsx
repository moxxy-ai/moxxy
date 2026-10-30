/**
 * The voices that read replies aloud in Settings → Voice: Supertonic on this
 * computer, or Gemini on the person's key. Render-only; IPC and async state
 * live in `useVoiceSettings`.
 */

import { Button, TextInput } from '@moxxy/desktop-ui';
import { Badge, CardGroup, Row } from './settings-primitives';
import type { VoiceSettingsState } from './useVoiceSettings';

const LOCAL_VOICE_BACKEND = 'local-supertonic';
const GEMINI_BACKEND = 'gemini-tts';

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 11px',
  border: '1px solid var(--color-card-border)',
  borderRadius: 'var(--radius-block)',
  background: 'var(--color-input-bg, var(--color-card-bg))',
  color: 'var(--color-text)',
};

export function ReadAloudSection({ voice }: { readonly voice: VoiceSettingsState }): JSX.Element {
  const localInUse = voice.backend === LOCAL_VOICE_BACKEND;
  const geminiInUse = voice.backend === GEMINI_BACKEND;
  return (
    <CardGroup
      id="voice-read-aloud"
      title="Reading replies aloud"
      description="The voice for the Classic engine and the speaker button on replies."
    >
      <Row
        testId="voice-model-supertonic"
        tile={null}
        title="Supertonic 3"
        subtitle="Reads replies aloud on this computer, in Polish and English."
        badges={localInUse ? <Badge>In use</Badge> : undefined}
        trailing={!localInUse && (
          <Button
            variant="secondary"
            size="sm"
            disabled={voice.busy || voice.loading}
            onClick={() => void voice.useLocalVoice()}
          >
            {voice.busy ? 'Setting up…' : 'Use'}
          </Button>
        )}
      />
      <Row
        testId="voice-model-gemini"
        tile={null}
        title="Gemini Flash-Lite"
        subtitle="Cloud speech using your Google AI Studio key. Voice data is sent to Google for synthesis."
        badges={geminiInUse ? <Badge>In use</Badge> : undefined}
        below={<GeminiFields voice={voice} />}
      />
    </CardGroup>
  );
}

function GeminiFields({ voice }: { readonly voice: VoiceSettingsState }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
      <label htmlFor="gemini-tts-key" style={{ fontSize: 'var(--type-meta)' }}>
        Gemini API key {voice.hasGeminiKey ? '· key saved in this device vault' : ''}
      </label>
      <TextInput
        id="gemini-tts-key"
        type="password"
        value={voice.apiKeyDraft}
        onChange={(event) => voice.setApiKeyDraft(event.target.value)}
        placeholder={voice.hasGeminiKey ? 'Paste a replacement key' : 'Paste your Gemini API key'}
        autoComplete="off"
        style={fieldStyle}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="secondary" disabled={voice.busy || !voice.apiKeyDraft.trim()} onClick={() => void voice.saveGeminiApiKey()}>
          Save key
        </Button>
        <Button variant="secondary" disabled={voice.loading || voice.loadingVoices || !voice.hasGeminiKey} onClick={() => void voice.loadVoices()}>
          {voice.loadingVoices ? 'Loading voices…' : voice.voices.length > 0 ? 'Refresh voices' : 'Load voices'}
        </Button>
      </div>
      <label htmlFor="gemini-tts-voice" style={{ fontSize: 'var(--type-meta)' }}>Voice from your Google library</label>
      <select
        id="gemini-tts-voice"
        value={voice.selectedVoiceId}
        onChange={(event) => voice.setSelectedVoiceId(event.target.value)}
        disabled={voice.voices.length === 0 || voice.busy}
        style={fieldStyle}
      >
        {voice.voices.length === 0 && <option value={voice.selectedVoiceId}>Load voices to choose one</option>}
        {voice.voices.map((item) => (
          <option key={item.id} value={item.id}>
            {item.displayName}{item.languageCode ? ` · ${item.languageCode}` : ''} ({item.id})
          </option>
        ))}
      </select>
      <div>
        <Button
          variant="cta"
          disabled={voice.busy || !voice.hasGeminiKey || voice.voices.length === 0}
          onClick={() => void voice.useGeminiVoice()}
        >
          {voice.busy && voice.backend !== GEMINI_BACKEND ? 'Setting up…' : 'Use Gemini voice'}
        </Button>
      </div>
    </div>
  );
}
