import { Button, TextInput } from '@moxxy/desktop-ui';
import { useVoiceEnginePreference } from '@/voice-call/useVoiceEngine';
import { Section } from './settings-primitives';
import { useVoiceSettings, type VoiceSettingsState } from './useVoiceSettings';
import { VoiceEngineSection } from './VoiceEngineSection';

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 16,
  background: 'var(--color-card-bg)',
  border: '1px solid var(--color-card-border)',
  borderRadius: 'var(--radius-card)',
};

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 11px',
  border: '1px solid var(--color-card-border)',
  borderRadius: 'var(--radius-block)',
  background: 'var(--color-input-bg, var(--color-card-bg))',
  color: 'var(--color-text)',
};

const noteStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--color-text-dim)',
  fontSize: 'var(--type-meta)',
};

/** Render-only surface for everything voice: the Voice Mode engine and, for the
 *  Local engine, the spoken voice. IPC and lifecycle live in the hooks. */
export function VoiceTab(): JSX.Element {
  const engine = useVoiceEnginePreference();
  const voice = useVoiceSettings();

  return (
    <Section title="Voice" description="Choose how Voice Mode talks with you and which voice reads replies aloud.">
      <VoiceEngineSection />
      {engine === 'gpt-live' ? (
        <p style={noteStyle}>
          GPT-Live speaks with its own voice. Switch to Local to choose a Gemini or Piper voice.
        </p>
      ) : (
        <SpokenVoicePicker voice={voice} />
      )}
      {voice.error && (
        <div role="alert" style={{ color: 'var(--color-red)', fontSize: 'var(--type-meta)' }}>{voice.error}</div>
      )}
    </Section>
  );
}

/** The voice the Local engine reads replies with: cloud Gemini or on-device Piper. */
function SpokenVoicePicker({ voice }: { readonly voice: VoiceSettingsState }): JSX.Element {
  const activeLabel = voice.backend === 'gemini-tts'
    ? `Cloud · ${voice.selectedVoiceId}`
    : voice.backend === 'local-piper'
      ? 'Local · Piper'
      : voice.backend ? `Other · ${voice.backend}` : 'System default';

  return (
    <>
      <p style={noteStyle}>
        Spoken voice for the Local engine. Speech is played one sentence at a time, with up to two upcoming sentences prepared ahead to reduce pauses.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        <section style={cardStyle} aria-labelledby="voice-cloud-title">
          <div>
            <h3 id="voice-cloud-title" style={{ margin: 0, fontSize: 'var(--type-section)' }}>Gemini Flash-Lite</h3>
            <p style={{ margin: '5px 0 0', color: 'var(--color-text-dim)', fontSize: 'var(--type-meta)' }}>
              Cloud speech using your Google AI Studio key. Voice data is sent to Google for synthesis.
            </p>
          </div>
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
          <Button
            variant="cta"
            disabled={voice.busy || !voice.hasGeminiKey || voice.voices.length === 0}
            onClick={() => void voice.useGeminiVoice()}
          >
            {voice.busy && voice.backend !== 'gemini-tts' ? 'Setting up…' : 'Use Gemini voice'}
          </Button>
        </section>

        <section style={cardStyle} aria-labelledby="voice-local-title">
          <div>
            <h3 id="voice-local-title" style={{ margin: 0, fontSize: 'var(--type-section)' }}>Local Piper</h3>
            <p style={{ margin: '5px 0 0', color: 'var(--color-text-dim)', fontSize: 'var(--type-meta)' }}>
              On-device speech synthesis. No cloud key and no per-use API charge.
            </p>
          </div>
          <div style={{ color: 'var(--color-text-dim)', fontSize: 'var(--type-meta)' }}>
            {voice.localPiperInstalled ? 'Piper package is installed.' : 'Piper will be installed when selected.'}
          </div>
          <Button
            variant={voice.backend === 'local-piper' ? 'secondary' : 'cta'}
            disabled={voice.busy || voice.loading}
            onClick={() => void voice.useLocalPiper()}
          >
            {voice.busy && voice.backend !== 'local-piper' ? 'Setting up…' : 'Use local Piper'}
          </Button>
        </section>
      </div>
      <div role="status" style={{ color: 'var(--color-text-dim)', fontSize: 'var(--type-meta)' }}>
        Current voice: {voice.loading ? 'Loading…' : activeLabel}
      </div>
    </>
  );
}
