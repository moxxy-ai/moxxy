/**
 * Voice section — picks the engine Voice Mode talks through. The choice is
 * read and written through the shared store in `voice-call/useVoiceEngine`,
 * so an open chat switches engines the next time Voice Mode starts.
 */

import type { VoiceEnginePreference } from '@moxxy/desktop-ipc-contract';
import {
  setVoiceEnginePreference,
  useVoiceEnginePreference,
} from '@/voice-call/useVoiceEngine';
import { Section } from './settings-primitives';
import { Segmented } from '../shell/Segmented';

const ENGINE_OPTIONS: ReadonlyArray<{ id: VoiceEnginePreference; label: string }> = [
  { id: 'local', label: 'Local' },
  { id: 'gpt-live', label: 'GPT-Live' },
];

const ENGINE_DETAIL: Readonly<Record<VoiceEnginePreference, string>> = {
  local: 'Your speech is transcribed and answered by the Moxxy agent, then read aloud by the offline Local Piper voice.',
  'gpt-live': 'A live GPT-Live conversation over your ChatGPT login. It knows the chat and talks with you itself; when you ask for something to be done, your exact words go to the Moxxy agent and GPT-Live reads back the real result. Uses your ChatGPT voice allowance.',
};

export function VoiceEngineSection(): JSX.Element {
  const engine = useVoiceEnginePreference();
  return (
    <Section
      title="Voice"
      description="Choose how Voice Mode talks with you."
    >
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
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 14,
          }}
        >
          <div style={{ fontSize: 'var(--type-ui)', fontWeight: 600 }}>Voice engine</div>
          <Segmented
            items={ENGINE_OPTIONS}
            value={engine}
            onChange={setVoiceEnginePreference}
            testIdPrefix="voice-engine-"
          />
        </div>
        <div style={{ fontSize: 'var(--type-meta)', color: 'var(--color-text-muted)' }}>
          {ENGINE_DETAIL[engine]}
        </div>
      </div>
    </Section>
  );
}
