/**
 * Notifications card in Settings → Preferences. Each switch is read and
 * written through its shared store (`attention/`, `notices/`), the one the
 * window's chime, toasts and system notifications read.
 */
import type { ReactNode } from 'react';
import { setReplySoundPreference, useReplySoundPreference } from '@/attention/useReplySoundPreference';
import {
  setSystemNotificationsPreference,
  useSystemNotificationsPreference,
} from '@/attention/useSystemNotificationsPreference';
import { setInAppToastsPreference, useInAppToastsPreference } from '@/notices/useInAppToastsPreference';
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
  const toasts = useInAppToastsPreference();
  return (
    <Section
      title="Notifications"
      description="How Moxxy tells you that a chat needs you or that work in the background has finished."
    >
      <div style={{ display: 'grid', gap: 8 }}>
        <Row title="Sound" detail="A short chime when a chat you are not reading answers or stops to ask.">
          <Switch on={sound} onClick={() => setReplySoundPreference(!sound)} label="Sound when a chat needs you" />
        </Row>
        <Row
          title="In-app toasts"
          detail="A short note inside Moxxy, in the top-right corner, while you are using the app: a chat you are not reading answered or stopped to ask, or something finished in the background, like a model download. Click it to open what it is about."
        >
          <Switch on={toasts} onClick={() => setInAppToastsPreference(!toasts)} label="Toasts inside Moxxy" />
        </Row>
        <Row
          title="System notification"
          detail="A notification from macOS, Windows or Linux while Moxxy is in the background or minimised, for the same moments. Click it to bring Moxxy back on what it is about."
        >
          <Switch
            on={banner}
            onClick={() => setSystemNotificationsPreference(!banner)}
            label="System notification when a chat needs you or background work finishes"
          />
        </Row>
      </div>
    </Section>
  );
}
