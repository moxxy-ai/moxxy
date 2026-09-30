import { useState } from 'react';
import { Icon } from '@moxxy/desktop-ui';
import { Button } from '@moxxy/desktop-ui';
import {
  useActiveWorkspaceId,
  useChannelChat,
  useChannels,
  useConnection,
  useSessionInfoReady,
  type UseChannels,
} from '@moxxy/client-core';
import type { ChannelEntry, ConnectionPhase } from '@moxxy/desktop-ipc-contract';
import { ChannelActions, ChannelPage, ChannelRunButton, ledState, useChannelPage } from '../apps/ChannelsPanel';
import { ChatSurface } from '../chat/ChatSurface';
import type { ModelOwner } from '../chat/agent-picker/useAgentSession';
import { IndexColumn } from '../shell/IndexColumn';
import { BarActions, InstrumentBar } from '../shell/InstrumentBar';
import { Workbench } from '../shell/Workbench';
import { useWorkbench } from '../shell/useWorkbench';
import { ChannelModelSection } from './ChannelModelSection';
import { ChannelRunModeSection } from './ChannelRunModeSection';
import { useChannelModel } from './useChannelModel';
import { useChannelRunMode } from './useChannelRunMode';

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
      <main className="field">
        <InstrumentBar crumbs={['Channels', 'Catalog']}>{refresh}</InstrumentBar>
        <div style={PANE}>
          {error}
          <p style={{ margin: 0, color: 'var(--color-text-dim)', fontSize: 'var(--type-row)' }}>
            Pick a channel from the list to set it up.
          </p>
        </div>
      </main>
    );
  }
  // Keyed on the channel so switching pages resets the form rather than
  // carrying one channel's half-typed secrets into the next one's fields.
  return <ChannelScreen key={entry.descriptor.id} entry={entry} channels={channels} error={error} refresh={refresh} />;
}

/**
 * A channel is two pages: its CHAT — the bot's conversation as an ordinary
 * chat, written to from the channel and from here — and its SETUP. A channel
 * that is set up opens on its chat; one that is not opens on its setup.
 */
function ChannelScreen({
  entry,
  channels,
  error,
  refresh,
}: {
  readonly entry: ChannelEntry;
  readonly channels: UseChannels;
  readonly error: React.ReactNode;
  readonly refresh: React.ReactNode;
}): JSX.Element {
  const [page, setPage] = useState<'chat' | 'setup'>(entry.status.configured ? 'chat' : 'setup');
  if (page === 'chat' && entry.status.configured) {
    return <ChannelChat entry={entry} channels={channels} onSetup={() => setPage('setup')} />;
  }
  return (
    <main className="field">
      <ChannelView
        entry={entry}
        channels={channels}
        error={error}
        refresh={refresh}
        {...(entry.status.configured ? { onChat: () => setPage('chat') } : {})}
      />
    </main>
  );
}

const NOT_ATTACHED: ConnectionPhase = { phase: 'idle' };

/** The bot's conversation, live: the regular chat surface over the bot's own
 *  runner (`channels.openChat`), with the bot's run control in the bar and the
 *  same workbench as a workspace chat — the bot's agent drives the app's
 *  browser and terminal, and this is where you watch it and take over. */
function ChannelChat({
  entry,
  channels,
  onSetup,
}: {
  readonly entry: ChannelEntry;
  readonly channels: UseChannels;
  readonly onSetup: () => void;
}): JSX.Element {
  const { descriptor } = entry;
  const chat = useChannelChat(descriptor.id);
  const state = useChannelPage(entry, channels);
  const actions = (
    <BarActions>
      <ChannelRunButton entry={entry} state={state} />
      <Button variant="secondary" onClick={onSetup} data-testid={`channel-setup-${descriptor.id}`}>
        Setup
      </Button>
    </BarActions>
  );
  if (!chat.workspaceId) {
    return (
      <main className="field">
        <InstrumentBar crumbs={['Channels', descriptor.name]}>{actions}</InstrumentBar>
        <div style={PANE}>
          <p role={chat.error ? 'alert' : 'status'} style={{ margin: 0, color: 'var(--color-text-dim)', fontSize: 'var(--type-row)' }}>
            {chat.error ?? 'Opening the conversation…'}
          </p>
        </div>
      </main>
    );
  }
  return (
    <>
      <ChannelChatSurface
        workspaceId={chat.workspaceId}
        name={descriptor.name}
        {...(descriptor.supportsModel ? { modelOwner: botModel(descriptor.id, channels.setModel) } : {})}
      />
      {actions}
    </>
  );
}

/** The bot owns its chat's model: a pick in the chat header is the bot's model
 *  (the same `channels.setModel` as Setup), which the bot runs next. */
function botModel(channelId: string, setModel: UseChannels['setModel']): ModelOwner {
  return { pick: (provider, model) => setModel(channelId, `${provider}::${model}`) };
}

function ChannelChatSurface({
  workspaceId,
  name,
  modelOwner,
}: {
  readonly workspaceId: string;
  readonly name: string;
  readonly modelOwner?: ModelOwner;
}): JSX.Element {
  const phase = useConnection(workspaceId).snapshot?.phase ?? NOT_ATTACHED;
  const infoReady = useSessionInfoReady(workspaceId, phase);
  const [benchTab, setBenchTab] = useWorkbench(workspaceId);
  const online = phase.phase === 'connected';
  return (
    <>
      <ChatSurface
        phase={phase}
        workspaceId={workspaceId}
        sessionLoading={online && !infoReady}
        title={{ context: 'Channels', subject: name }}
        {...(modelOwner ? { modelOwner } : {})}
        notice={
          online ? null : (
            <p
              role="status"
              style={{
                margin: 'var(--space-8) var(--space-32) 0',
                fontSize: 'var(--type-meta)',
                color: 'var(--color-text-dim)',
              }}
            >
              The {name} bot is not running — start it to chat here. Earlier messages stay below.
            </p>
          )
        }
      />
      <Workbench tab={benchTab} onPick={setBenchTab} onClose={() => setBenchTab(null)} workspaceId={workspaceId} />
    </>
  );
}

const PANE: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: 'var(--space-20) var(--space-32) var(--space-40)',
};

/** One channel: the bar that names it (carrying its actions) and the pane that
 *  configures it. Both halves read ONE editing state, which is why they live in
 *  the same component rather than the surface holding the state for them. It
 *  acts through the surface's `channels` — the list `entry` comes from — so a
 *  command's reply (run mode, model) lands in the entry it renders. */
function ChannelView({
  entry,
  channels,
  error,
  refresh,
  onChat,
}: {
  readonly entry: ChannelEntry;
  readonly channels: UseChannels;
  readonly error: React.ReactNode;
  readonly refresh: React.ReactNode;
  /** Back to the chat — only for a channel that is set up. */
  readonly onChat?: () => void;
}): JSX.Element {
  const state = useChannelPage(entry, channels);
  const workspaceId = useActiveWorkspaceId();
  const model = useChannelModel({
    channelId: entry.descriptor.id,
    model: entry.status.model,
    workspaceId,
    setModel: channels.setModel,
  });
  const runMode = useChannelRunMode({
    channelId: entry.descriptor.id,
    runMode: entry.status.runMode,
    background: entry.status.background,
    setRunMode: channels.setRunMode,
  });
  return (
    <>
      <InstrumentBar crumbs={['Channels', entry.descriptor.name]}>
        {/* A page's actions belong in the bar that names the page, not floating
         *  over its first paragraph. */}
        <ChannelActions entry={entry} state={state} />
        {onChat && (
          <Button variant="secondary" onClick={onChat} data-testid={`channel-chat-${entry.descriptor.id}`}>
            Chat
          </Button>
        )}
        {refresh}
      </InstrumentBar>
      <div style={PANE}>
        {error}
        <ChannelPage entry={entry} state={state} />
        {entry.descriptor.supportsBackground && (
          <div style={{ marginTop: 'var(--space-20)' }}>
            <ChannelRunModeSection state={runMode} />
          </div>
        )}
        {entry.descriptor.supportsModel && (
          <div style={{ marginTop: 'var(--space-20)' }}>
            <ChannelModelSection state={model} />
          </div>
        )}
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
