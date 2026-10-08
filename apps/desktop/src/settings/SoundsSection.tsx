/**
 * Sounds card in Settings → Preferences. The switch is read and written
 * through the shared store in `reply-sound/useReplySoundPreference`, the one
 * the window's chime reads.
 */
import { setReplySoundPreference, useReplySoundPreference } from '@/reply-sound/useReplySoundPreference';
import { Section, Switch } from './settings-primitives';

export function SoundsSection(): JSX.Element {
  const replySound = useReplySoundPreference();
  return (
    <Section title="Sounds" description="What Moxxy lets you hear while you work.">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
          padding: '13px 16px',
          background: 'var(--color-card-bg)',
          border: '1px solid var(--color-card-border)',
          borderRadius: 'var(--radius-card)',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 'var(--type-ui)', fontWeight: 600 }}>Another chat answers</div>
          <div style={{ fontSize: 'var(--type-meta)', color: 'var(--color-text-muted)' }}>
            A short chime when a chat that is not on screen finishes its answer.
          </div>
        </div>
        <Switch
          on={replySound}
          onClick={() => setReplySoundPreference(!replySound)}
          label="Sound when another chat answers"
        />
      </div>
    </Section>
  );
}
