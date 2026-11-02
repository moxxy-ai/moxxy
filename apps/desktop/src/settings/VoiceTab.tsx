import { useVoiceEnginePreference } from '@/voice-call/useVoiceEngine';
import { DictationSection } from './DictationSection';
import { ReadAloudSection } from './ReadAloudSection';
import { Section } from './settings-primitives';
import { useTranscriptionSettings } from './useTranscriptionSettings';
import { useVaultKey } from './useVaultKey';
import { useVoiceSettings } from './useVoiceSettings';
import { VoiceEngineSection } from './VoiceEngineSection';

/** Render-only surface for everything voice, on one page: the Voice Mode engine,
 *  the dictation models and the voices that read replies aloud. IPC and
 *  lifecycle live in the hooks. */
export function VoiceTab(): JSX.Element {
  const engine = useVoiceEnginePreference();
  const voice = useVoiceSettings();
  const transcription = useTranscriptionSettings();
  const openAiKey = useVaultKey('OPENAI_API_KEY');

  return (
    <Section
      title="Voice"
      description="Choose how Voice Mode talks with you, which model turns your speech into text and which voice reads replies aloud."
    >
      <VoiceEngineSection />
      <DictationSection transcription={transcription} openAiKey={openAiKey} />
      {engine === 'gpt-live' ? (
        <p style={{ margin: 0, color: 'var(--color-text-dim)', fontSize: 'var(--type-meta)' }}>
          GPT-Live speaks with its own voice. Switch the voice engine to Classic to choose a Gemini or local voice.
        </p>
      ) : (
        <ReadAloudSection voice={voice} />
      )}
      {voice.error && (
        <div role="alert" style={{ color: 'var(--color-red)', fontSize: 'var(--type-meta)' }}>{voice.error}</div>
      )}
    </Section>
  );
}
