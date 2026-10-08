/**
 * Notifications card in Settings → Preferences. Each switch is read and
 * written through its shared store in `attention/`, the one the window's
 * chime and banner read.
 */
import type { ReactNode } from 'react';
import { setReplySoundPreference, useReplySoundPreference } from '@/attention/useReplySoundPreference';
import {
  setSystemNotificationsPreference,
  useSystemNotificationsPreference,
} from '@/attention/useSystemNotificationsPreference';
import { Section, Switch } from './settings-primitives';

function Row({ title, detail, children }: { title: string; detail: string; children: ReactNode }): JSX.Element {
  return (
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
        <div style={{ fontSize: 'var(--type-ui)', fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 'var(--type-meta)', color: 'var(--color-text-muted)' }}>{detail}</div>
      </div>
      {children}
    </div>
  );
}

export function NotificationsSection(): JSX.Element {
  const sound = useReplySoundPreference();
  const banner = useSystemNotificationsPreference();
  return (
    <Section title="Notifications" description="How Moxxy calls you back when a chat needs you.">
      <div style={{ display: 'grid', gap: 8 }}>
        <Row title="Sound" detail="A short chime when a chat you are not reading answers or stops to ask.">
          <Switch on={sound} onClick={() => setReplySoundPreference(!sound)} label="Sound when a chat needs you" />
        </Row>
        <Row
          title="System notification"
          detail="A banner from your system when that happens while Moxxy is in the background. Click it to open the chat."
        >
          <Switch
            on={banner}
            onClick={() => setSystemNotificationsPreference(!banner)}
            label="System notification when a chat needs you"
          />
        </Row>
      </div>
    </Section>
  );
}
