import { Button, TextInput } from '@moxxy/desktop-ui';
import { Section } from './settings-primitives';
import { useVoiceSettings } from './useVoiceSettings';

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

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 6,
  maximumFractionDigits: 6,
});

const tokenFormatter = new Intl.NumberFormat('en-US');

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** Render-only surface for voice preferences; IPC and lifecycle live in the hook. */
export function VoiceTab(): JSX.Element {
  const voice = useVoiceSettings();
  const activeLabel = voice.backend === 'gemini-tts'
    ? `Cloud · ${voice.selectedVoiceId}`
    : voice.backend === 'local-piper'
      ? 'Local · Piper'
      : voice.backend ? `Other · ${voice.backend}` : 'System default';

  return (
    <Section
      title="Voice"
      description="Choose how Moxxy speaks in voice conversations. Speech is played one sentence at a time, with up to two upcoming sentences prepared ahead to reduce pauses."
    >
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
          <section
            aria-labelledby="gemini-tts-usage-title"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: 12,
              background: 'var(--color-panel-bg, var(--color-input-bg, var(--color-card-bg)))',
              border: '1px solid var(--color-card-border)',
              borderRadius: 'var(--radius-block)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <h4 id="gemini-tts-usage-title" style={{ margin: 0, fontSize: 'var(--type-meta)' }}>
                Estimated Gemini usage
              </h4>
              <Button variant="secondary" disabled={voice.loadingUsage} onClick={() => void voice.refreshUsage()}>
                {voice.loadingUsage ? 'Refreshing…' : 'Refresh'}
              </Button>
            </div>
            <output
              aria-live="polite"
              style={{ fontSize: 'var(--type-title)', fontWeight: 700, color: 'var(--color-text)' }}
            >
              {voice.loadingUsage && !voice.usage ? 'Loading…' : usdFormatter.format(voice.usage?.estimatedCostUsd ?? 0)}
            </output>
            <div style={{ color: 'var(--color-text-dim)', fontSize: 'var(--type-meta)' }}>
              {voice.usage
                ? `${tokenFormatter.format(voice.usage.inputTextTokens)} text tokens · ${tokenFormatter.format(voice.usage.outputAudioTokens)} audio tokens · ${tokenFormatter.format(voice.usage.requestCount)} requests`
                : 'No Gemini usage has been recorded on this device yet.'}
            </div>
            {voice.usage?.updatedAt && (
              <div style={{ color: 'var(--color-text-dim)', fontSize: 'var(--type-meta)' }}>
                Last recorded {dateFormatter.format(new Date(voice.usage.updatedAt))}
              </div>
            )}
            <div style={{ color: 'var(--color-text-dim)', fontSize: 'var(--type-meta)' }}>
              Paid Standard estimate through Dec 31, 2026: $0.50 / 1M text tokens + $6 / 1M audio tokens.
              Google free-tier credits and interrupted requests without returned usage data are not included.
            </div>
          </section>
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
      {voice.error && (
        <div role="alert" style={{ color: 'var(--color-red)', fontSize: 'var(--type-meta)' }}>{voice.error}</div>
      )}
    </Section>
  );
}
