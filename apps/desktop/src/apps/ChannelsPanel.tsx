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

/** The one state a channel reports, in the order that matters to a reader:
 *  broken first, then live, then ready, then untouched. Shared with the index
 *  column so a channel's LED means the same thing in the list and on its page. */
export function ledState(entry: ChannelEntry): 'failed' | 'running' | 'done' | undefined {
  if (entry.status.error) return 'failed';
  if (entry.status.running) return entry.status.connected === false ? undefined : 'running';
  if (entry.status.configured) return 'done';
  return undefined;
}

export function statusLabel(entry: ChannelEntry): string {
  if (entry.status.error) return 'stopped · error';
  if (entry.status.running) return entry.status.connected === false ? 'pairing' : 'running';
  if (entry.status.configured) return 'configured';
  return 'not configured';
}

export function ChannelPage({
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
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-20)' }}
    >
      {/* The page IS the channel, so its name is the page's head, not a card's.
          This was a bordered panel wrapping a bordered panel wrapping the fields
          — three nested boxes for one form. */}
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-12)' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-8)' }}>
            <span style={{ fontSize: 'var(--type-section)', fontWeight: 600, letterSpacing: '-0.01em' }}>
              {descriptor.name}
            </span>
            <span className="led" data-state={ledState(entry)} aria-hidden />
            <span style={{ fontSize: 'var(--type-meta)', color: 'var(--color-text-dim)' }}>
              {statusLabel(entry)}
            </span>
          </div>
          <p
            className="prose"
            style={{ margin: 0, maxWidth: '62ch', fontSize: 'var(--type-ui)', color: 'var(--color-text-muted)' }}
          >
            {descriptor.description}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-6)', flexShrink: 0 }}>
          <Button
            variant="secondary"
            onClick={() => setConfiguring((v) => !v)}
            data-testid={`channel-configure-${descriptor.id}`}
          >
            {configuring ? 'Hide' : status.configured ? 'Reconfigure' : 'Configure'}
          </Button>
          <Button
            variant={status.running ? 'secondary' : 'cta'}
            onClick={() => void toggleRun()}
            disabled={busy || (!status.running && !status.configured)}
            data-testid={`channel-toggle-${descriptor.id}`}
          >
            <Icon name={status.running ? 'stop' : 'spark'} size={12} />
            {status.running ? 'Stop' : 'Start'}
          </Button>
        </div>
      </header>

      {configuring && (
        <div>
          <div className="section-head">setup</div>
          <div className="form">
            {descriptor.configFields.map((f) => (
              <label key={f.name} className="form__field">
                <span className="form__label">
                  {f.label}
                  {f.required ? '' : <small>optional</small>}
                </span>
                <TextInput
                  tone="soft"
                  mono={f.type === 'password'}
                  type={f.type === 'password' ? 'password' : 'text'}
                  value={values[f.name] ?? ''}
                  onChange={(e) => setField(f.name, e.target.value)}
                  placeholder={
                    f.placeholder ?? (status.configured ? 'Stored — leave blank to keep' : '')
                  }
                  style={{ width: '100%' }}
                />
                {f.help && <span className="form__hint">{f.help}</span>}
              </label>
            ))}
            <div className="form__acts">
              <Button
                variant="cta"
                onClick={() => void save()}
                disabled={busy || Object.values(values).every((v) => !v.trim())}
              >
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Running affordances: once the other side is connected (e.g. a Telegram
          chat paired) the connect step is done — show a "✓ Connected" note.
          Otherwise render the declarative per-channel connect step (QR / URL /
          instructions). Channels without a `connect` fall back to the legacy hint. */}
      {status.running && status.connected ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 'var(--type-meta)',
            color: 'var(--color-green)',
          }}
        >
          <Icon name="check" size={14} />
          Connected
        </div>
      ) : status.running && descriptor.connect ? (
        <ConnectStep connect={descriptor.connect} url={status.requestUrl} />
      ) : (
        status.running &&
        descriptor.runHint && (
          <div style={{ fontSize: 'var(--type-meta)', color: 'var(--color-text-dim)' }}>
            {descriptor.runHint}
          </div>
        )
      )}
      {status.error && (
        <div
          role="alert"
          className="mono"
          style={{ fontSize: 'var(--type-meta)', color: 'var(--color-pink)', whiteSpace: 'pre-wrap' }}
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
            fontSize: 'var(--type-meta)',
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
      <div style={{ fontSize: 'var(--type-meta)', color: 'var(--color-text-dim)' }}>
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
    <span style={{ fontSize: 'var(--type-meta)', fontWeight: 600, color: 'var(--color-text)' }}>
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
        borderRadius: 'var(--radius-block)',
      }}
    >
      <span
        className="mono"
        title={url}
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 'var(--type-meta)',
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
          style={{ borderRadius: 'var(--radius-block)' }}
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
        style={{ borderRadius: 'var(--radius-block)' }}
      >
        <Icon name={copied ? 'check' : 'copy'} size={14} />
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}
