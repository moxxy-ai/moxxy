import { useState } from 'react';
import { ChannelsPanel } from '../apps/ChannelsPanel';
import { MobilePanel } from '../mobile/MobilePanel';
import { IndexColumn } from '../shell/IndexColumn';
import { InstrumentBar } from '../shell/InstrumentBar';

/**
 * Channels: every way a conversation reaches moxxy.
 *
 * Mobile used to be its own top-level destination, sitting at the bottom of the
 * workspace sidebar beside Settings. Pairing a phone is one channel among Slack,
 * Telegram, Signal and the rest — it was top-level because of how it was built (a
 * gateway in the main process), not because of what it is to a user.
 */

type Section = 'connected' | 'mobile';

const SECTIONS: ReadonlyArray<{
  readonly id: Section;
  readonly label: string;
  readonly hint: string;
}> = [
  { id: 'connected', label: 'Channels', hint: 'Slack, Telegram, …' },
  { id: 'mobile', label: 'Mobile', hint: 'Pair a phone' },
];

const TITLE: Record<Section, string> = { connected: 'Channels', mobile: 'Mobile' };

export function ChannelsIndex({
  section,
  onPick,
}: {
  readonly section: Section;
  readonly onPick: (section: Section) => void;
}): JSX.Element | null {
  return (
    <IndexColumn title="channels">
      {SECTIONS.map((s) => (
        <button
          key={s.id}
          type="button"
          className={s.id === section ? 'session-row' : 'session-row row-button'}
          data-testid={`channels-section-${s.id}`}
          data-active={s.id === section}
          aria-current={s.id === section ? 'true' : undefined}
          onClick={() => onPick(s.id)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-8)',
            width: '100%',
            minHeight: 'var(--frame-row)',
            padding: '2px var(--space-6) 2px var(--space-8)',
            borderRadius: 'var(--radius-block)',
            background: s.id === section ? 'var(--color-card-bg)' : 'transparent',
            color:
              s.id === section ? 'var(--color-sidebar-text)' : 'var(--color-sidebar-text-dim)',
            fontWeight: s.id === section ? 600 : 400,
            fontSize: 'var(--type-row)',
            textAlign: 'left',
          }}
        >
          <span className="led" aria-hidden />
          <span style={{ flex: 1, minWidth: 0 }}>{s.label}</span>
          <span
            style={{
              flexShrink: 0,
              fontSize: 'var(--type-label)',
              color: 'var(--color-text-dim)',
            }}
          >
            {s.hint}
          </span>
        </button>
      ))}
    </IndexColumn>
  );
}

export function ChannelsSurface({ section }: { readonly section: Section }): JSX.Element {
  return (
    <>
      <InstrumentBar crumbs={['Channels', TITLE[section]]} />
      {section === 'connected' ? <ChannelsPanel /> : <MobilePanel embedded />}
    </>
  );
}

/** The section the Channels destination lands on. */
export function useChannelsSection(): readonly [Section, (s: Section) => void] {
  const [section, setSection] = useState<Section>('connected');
  return [section, setSection];
}
