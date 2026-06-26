/**
 * Channels sub-view of the Apps surface. Lists the communication channels the
 * desktop can run (Slack, Telegram), each on its own dedicated, isolated runner.
 * Per channel: enter its secrets (stored in the vault), Start/Stop the runner,
 * and — once running — a declarative "connect step" (the channel's descriptor
 * says how to render it: Slack's Request URL to paste, Telegram's t.me QR + link
 * to open). Content-only — the Apps header is owned by {@link AppsPanel}.
 *
 * The channel's conversation is intentionally NOT shown here (it runs as a
 * separate isolated session); this panel manages the runner, not its chat.
 */

import { useState } from 'react';
import { api, useChannels } from '@moxxy/client-core';
import { Button, Icon, Skeleton, TextInput } from '@moxxy/desktop-ui';
import type { ChannelDescriptor, ChannelEntry } from '@moxxy/desktop-ipc-contract';
import { QrCode } from '../components/QrCode';

export function ChannelsPanel(): JSX.Element {
  const channels = useChannels();

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 24px 0' }}>
        <Button variant="chip" onClick={() => void channels.refresh()} style={{ borderRadius: 9 }}>
          <Icon name="rotate" size={14} />
          Refresh
        </Button>
      </div>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '1.5rem 2rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        {channels.error && (
          <p
            role="alert"
            style={{
              margin: 0,
              padding: '0.45rem 0.65rem',
              border: '1px solid var(--color-pink)',
              background: 'color-mix(in oklab, var(--color-pink) 12%, transparent)',
              borderRadius: 'var(--radius-block)',
              fontSize: '0.85rem',
            }}
          >
            {channels.error}
          </p>
        )}
        {channels.loading && channels.list.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <Skeleton.Card />
            <Skeleton.Card />
          </div>
        ) : (
          channels.list.map((entry) => (
            <ChannelCard
              key={entry.descriptor.id}
              entry={entry}
              onSaveConfig={channels.saveConfig}
              onStart={channels.start}
              onStop={channels.stop}
            />
          ))
        )}
      </div>
    </>
  );
}

/** Status dot color: green running · red errored · grey configured-idle · faint
 *  when not yet configured. */
function statusColor(entry: ChannelEntry): string {
  if (entry.status.running) return 'var(--color-green)';
  if (entry.status.error) return 'var(--color-pink)';
  if (entry.status.configured) return 'var(--color-text-dim)';
  return 'var(--color-border)';
}

function statusLabel(entry: ChannelEntry): string {
  if (entry.status.running) return 'Running';
  if (entry.status.error) return 'Stopped (error)';
  if (entry.status.configured) return 'Configured';
  return 'Not configured';
}

function ChannelCard({
  entry,
  onSaveConfig,
  onStart,
  onStop,
}: {
  readonly entry: ChannelEntry;
  readonly onSaveConfig: (id: string, values: Record<string, string>) => Promise<void>;
  readonly onStart: (id: string) => Promise<void>;
  readonly onStop: (id: string) => Promise<void>;
}): JSX.Element {
  const { descriptor, status } = entry;
  // Open the config form by default when nothing is stored yet.
  const [configuring, setConfiguring] = useState(!status.configured);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const setField = (name: string, v: string): void => setValues((cur) => ({ ...cur, [name]: v }));

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await onSaveConfig(descriptor.id, values);
      setValues({}); // don't retain secrets in renderer memory
      setConfiguring(false);
    } catch {
      /* error surfaced via the hook's error state */
    } finally {
      setBusy(false);
    }
  };

  const toggleRun = async (): Promise<void> => {
    setBusy(true);
    try {
      if (status.running) await onStop(descriptor.id);
      else await onStart(descriptor.id);
    } catch {
      /* error surfaced via the hook's error state */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid={`channel-row-${descriptor.id}`}
      style={{
        padding: '0.85rem 1rem',
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-block)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.6rem',
      }}
    >
      {/* Header: icon · name + status · run/configure controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <Icon name="chat" size={18} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{descriptor.name}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span
                aria-hidden
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: statusColor(entry),
                }}
              />
              <span style={{ fontSize: '0.72rem', color: 'var(--color-text-dim)' }}>
                {statusLabel(entry)}
              </span>
            </span>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
            {descriptor.description}
          </div>
        </div>
        <Button
          variant="chip"
          onClick={() => setConfiguring((v) => !v)}
          style={{ borderRadius: 9 }}
          data-testid={`channel-configure-${descriptor.id}`}
        >
          {configuring ? 'Hide' : status.configured ? 'Reconfigure' : 'Configure'}
        </Button>
        <Button
          variant={status.running ? 'secondary' : 'cta'}
          onClick={() => void toggleRun()}
          disabled={busy || (!status.running && !status.configured)}
          style={{ borderRadius: 9 }}
          data-testid={`channel-toggle-${descriptor.id}`}
        >
          <Icon name={status.running ? 'stop' : 'spark'} size={14} />
          {status.running ? 'Stop' : 'Start'}
        </Button>
      </div>

      {/* Config form */}
      {configuring && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '10px 12px',
            background: 'var(--color-card-bg)',
            border: '1px solid var(--color-card-border)',
            borderRadius: 12,
          }}
        >
          {descriptor.configFields.map((f) => (
            <label key={f.name} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                {f.label}
                {f.required ? '' : ' (optional)'}
              </span>
              <TextInput
                type={f.type === 'password' ? 'password' : 'text'}
                value={values[f.name] ?? ''}
                onChange={(e) => setField(f.name, e.target.value)}
                placeholder={
                  f.placeholder ?? (status.configured ? 'Stored — leave blank to keep' : '')
                }
                style={{ width: '100%', fontSize: 13, borderRadius: 9 }}
              />
              {f.help && (
                <span style={{ fontSize: '0.7rem', color: 'var(--color-text-dim)' }}>{f.help}</span>
              )}
            </label>
          ))}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button
              variant="cta"
              onClick={() => void save()}
              disabled={busy || Object.values(values).every((v) => !v.trim())}
              style={{ borderRadius: 9, padding: '7px 14px', fontSize: 12.5 }}
            >
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      )}

      {/* Running affordances: the declarative per-channel connect step (QR / URL /
          instructions). Channels without a `connect` fall back to the legacy hint. */}
      {status.running && descriptor.connect ? (
        <ConnectStep connect={descriptor.connect} url={status.requestUrl} />
      ) : (
        status.running &&
        descriptor.runHint && (
          <div style={{ fontSize: '0.78rem', color: 'var(--color-text-dim)' }}>
            {descriptor.runHint}
          </div>
        )
      )}
      {status.error && (
        <div
          role="alert"
          className="mono"
          style={{ fontSize: '0.72rem', color: 'var(--color-pink)', whiteSpace: 'pre-wrap' }}
        >
          {status.error}
        </div>
      )}
    </div>
  );
}

/** The declarative per-channel connect step, shown once the channel is running.
 *  The descriptor's `kind` picks the presentation; the runtime value is the
 *  channel's `requestUrl` (Slack's Request URL, Telegram's t.me link). A new
 *  channel plugs in by declaring a `connect` — no edits here. */
function ConnectStep({
  connect,
  url,
}: {
  readonly connect: NonNullable<ChannelDescriptor['connect']>;
  readonly url?: string;
}): JSX.Element {
  if (connect.kind === 'instructions') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {connect.title && <ConnectTitle>{connect.title}</ConnectTitle>}
        <ol
          style={{
            margin: 0,
            paddingLeft: '1.1rem',
            fontSize: '0.78rem',
            color: 'var(--color-text-dim)',
          }}
        >
          {(connect.steps ?? []).map((s) => (
            <li key={s} style={{ marginBottom: 3 }}>
              {s}
            </li>
          ))}
        </ol>
      </div>
    );
  }
  // 'qr' and 'url' both render a runtime value; until it resolves, show a hint.
  if (!url) {
    return (
      <div style={{ fontSize: '0.78rem', color: 'var(--color-text-dim)' }}>
        {connect.kind === 'qr'
          ? 'Connecting — the link will appear here once the bot is reachable…'
          : 'Opening the proxy tunnel — the Request URL will appear here…'}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {connect.title && <ConnectTitle>{connect.title}</ConnectTitle>}
      {connect.kind === 'qr' && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '2px 0' }}>
          <QrCode
            value={url}
            size={180}
            alt={connect.title ?? 'Connect QR code'}
            testId="channel-connect-qr"
          />
        </div>
      )}
      <ConnectUrlRow url={url} openable={connect.openable} openLabel={connect.openLabel} />
      {connect.hint && (
        <div style={{ fontSize: '0.74rem', color: 'var(--color-text-dim)' }}>{connect.hint}</div>
      )}
    </div>
  );
}

function ConnectTitle({ children }: { readonly children: string }): JSX.Element {
  return (
    <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text)' }}>
      {children}
    </span>
  );
}

/** A connect value (URL / link) with Copy and — when `openable` — an "open
 *  externally" button via the https-validated onboarding.openExternal IPC. */
function ConnectUrlRow({
  url,
  openable,
  openLabel,
}: {
  readonly url: string;
  readonly openable?: boolean;
  readonly openLabel?: string;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        background: 'var(--color-card-bg)',
        border: '1px solid var(--color-card-border)',
        borderRadius: 9,
      }}
    >
      <span
        className="mono"
        title={url}
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: '0.72rem',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {url}
      </span>
      {openable && (
        <Button
          variant="chip"
          onClick={() => void api().invoke('onboarding.openExternal', { url })}
          style={{ borderRadius: 9 }}
          data-testid="channel-connect-open"
        >
          <Icon name="globe" size={14} />
          {openLabel ?? 'Open'}
        </Button>
      )}
      <Button
        variant="chip"
        onClick={() => {
          void navigator.clipboard?.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        style={{ borderRadius: 9 }}
      >
        <Icon name={copied ? 'check' : 'copy'} size={14} />
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}
