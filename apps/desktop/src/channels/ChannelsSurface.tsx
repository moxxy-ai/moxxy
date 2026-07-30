import { useState } from 'react';
import { Icon } from '@moxxy/desktop-ui';
import { useChannels } from '@moxxy/client-core';
import type { ChannelEntry } from '@moxxy/desktop-ipc-contract';
import { ChannelActions, ChannelPage, ledState, useChannelPage } from '../apps/ChannelsPanel';
import { IndexColumn } from '../shell/IndexColumn';
import { InstrumentBar } from '../shell/InstrumentBar';

/**
 * Channels: one page per channel, picked from a collapsible group in the index
 * column.
 *
 * Every channel used to be a card in one long scroll, each with its own config
 * form open at all times — so setting up Slack meant scrolling past WhatsApp's
 * ban-risk consent gate, and the page was as tall as the catalog. A channel is a
 * thing you configure once and then leave alone; it deserves a page, and the
 * column deserves to show which ones are actually running.
 *
 * Mobile is NOT here. Pairing this machine with a phone is a property of the
 * install rather than another chat surface to configure: no catalog entry, no
 * dedicated runner, no secrets. It sits at the foot of the rail beside Settings.
 */

function channelNote(entry: ChannelEntry): string | null {
  if (entry.status.error) return 'error';
  if (entry.status.running) return entry.status.connected === false ? 'pairing' : 'live';
  if (entry.status.configured) return 'ready';
  return null;
}

export function ChannelsIndex({
  selected,
  onSelect,
}: {
  readonly selected: string | null;
  readonly onSelect: (id: string) => void;
}): JSX.Element | null {
  const channels = useChannels();
  const [folded, setFolded] = useState(false);
  const running = channels.list.filter((e) => e.status.running).length;

  return (
    <IndexColumn title="channels">
      <div
        role="button"
        tabIndex={0}
        data-testid="channels-group"
        aria-expanded={!folded}
        aria-label={`${folded ? 'expand' : 'collapse'} channels`}
        className="row-button index-group"
        style={{ cursor: 'pointer', borderRadius: 'var(--radius-block)' }}
        onClick={() => setFolded((f) => !f)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setFolded((f) => !f);
          }
        }}
      >
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            flexShrink: 0,
            transform: folded ? 'none' : 'rotate(90deg)',
            transition: 'transform var(--motion-shift) ease',
          }}
        >
          <Icon name="chevron-right" size={12} />
        </span>
        <span className="index-group__label">catalog</span>
        {/* Folded, the group still reports how many are live — that is the one
         *  fact you would open it to check. */}
        {folded && running > 0 && <span className="led" data-state="running" aria-hidden />}
        <span className="index-group__count">{channels.list.length}</span>
      </div>
      {!folded &&
        channels.list.map((entry) => {
          const id = entry.descriptor.id;
          const active = id === selected;
          const note = channelNote(entry);
          return (
            <button
              key={id}
              type="button"
              data-testid={`channel-row-${id}`}
              data-active={active}
              className={active ? 'session-row' : 'session-row row-button'}
              onClick={() => onSelect(id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-8)',
                width: '100%',
                minHeight: 'var(--frame-row)',
                padding: '2px var(--space-6) 2px var(--space-24)',
                borderRadius: 'var(--radius-block)',
                background: active ? 'var(--color-card-bg)' : 'transparent',
                color: active ? 'var(--color-sidebar-text)' : 'var(--color-sidebar-text-dim)',
                fontWeight: active ? 600 : 400,
                fontSize: 'var(--type-row)',
                textAlign: 'left',
              }}
            >
              <span className="led" data-state={ledState(entry)} aria-hidden />
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {entry.descriptor.name}
              </span>
              {note && (
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: 'var(--type-label)',
                    color:
                      note === 'error' ? 'var(--color-red-text)' : 'var(--color-text-dim)',
                  }}
                >
                  {note}
                </span>
              )}
            </button>
          );
        })}
      {!folded && channels.list.length === 0 && !channels.loading && (
        <p
          style={{
            margin: 0,
            padding: '2px var(--space-6) var(--space-6) var(--space-24)',
            fontSize: 'var(--type-label)',
            color: 'var(--color-text-dim)',
          }}
        >
          none available
        </p>
      )}
    </IndexColumn>
  );
}

export function ChannelsSurface({ selected }: { readonly selected: string | null }): JSX.Element {
  const channels = useChannels();
  const entry = channels.list.find((e) => e.descriptor.id === selected) ?? null;

  const refresh = (
    <button
      type="button"
      className="btn-box tip"
      data-tip="Refresh"
      data-tip-side="bottom"
      aria-label="Refresh channels"
      onClick={() => void channels.refresh()}
    >
      <Icon name="rotate" size={14} />
    </button>
  );
  const error = channels.error && (
    <p
      role="alert"
      style={{
        margin: '0 0 var(--space-12)',
        padding: 'var(--space-6) var(--space-8)',
        border: '1px solid var(--color-red-border)',
        background: 'var(--color-red-wash)',
        color: 'var(--color-red-text)',
        borderRadius: 'var(--radius-block)',
        fontSize: 'var(--type-row)',
      }}
    >
      {channels.error}
    </p>
  );

  if (!entry) {
    return (
      <>
        <InstrumentBar crumbs={['Channels', 'Catalog']}>{refresh}</InstrumentBar>
        <div style={PANE}>
          {error}
          <p style={{ margin: 0, color: 'var(--color-text-dim)', fontSize: 'var(--type-row)' }}>
            Pick a channel from the list to set it up.
          </p>
        </div>
      </>
    );
  }
  // Keyed on the channel so switching pages resets the form rather than
  // carrying one channel's half-typed secrets into the next one's fields.
  return <ChannelView key={entry.descriptor.id} entry={entry} error={error} refresh={refresh} />;
}

const PANE: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: 'var(--space-20) var(--space-32) var(--space-40)',
};

/** One channel: the bar that names it (carrying its actions) and the pane that
 *  configures it. Both halves read ONE editing state, which is why they live in
 *  the same component rather than the surface holding the state for them. */
function ChannelView({
  entry,
  error,
  refresh,
}: {
  readonly entry: ChannelEntry;
  readonly error: React.ReactNode;
  readonly refresh: React.ReactNode;
}): JSX.Element {
  const channels = useChannels();
  const state = useChannelPage(entry, channels);
  return (
    <>
      <InstrumentBar crumbs={['Channels', entry.descriptor.name]}>
        {/* A page's actions belong in the bar that names the page, not floating
         *  over its first paragraph. */}
        <ChannelActions entry={entry} state={state} />
        {refresh}
      </InstrumentBar>
      <div style={PANE}>
        {error}
        <ChannelPage entry={entry} state={state} />
      </div>
    </>
  );
}

/** Which channel page is open. Owned by the shell so the column and the pane
 *  agree, and so it survives leaving the destination and coming back. */
export function useChannelSelection(): readonly [string | null, (id: string) => void] {
  const [id, setId] = useState<string | null>(null);
  return [id, setId];
}
