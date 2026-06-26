import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { ChannelConfigField, ChannelDef, ChannelRunStatus } from '@moxxy/sdk';
import {
  clearChannelStatus,
  liveChannelStatus,
  spawnDedicatedChannel,
  stopDedicatedChannel,
} from '@moxxy/sdk/server';
import { Colors } from '../theme.js';
import { Modal } from './Modal.js';
import { useScrollableList } from './useScrollableList.js';
import type { VaultLike } from '../session/props.js';

export interface ChannelsPanelProps {
  /** Every registered channel; the panel shows the ones that declare `config`
   *  (i.e. run on their own dedicated runner — Slack, Telegram, …). */
  readonly channels: ReadonlyArray<ChannelDef>;
  /** The host's already-open vault for storing secrets, or null when attached to
   *  an external runner (config degrades to a hint; start/stop still work). */
  readonly vault: VaultLike | null;
  readonly onClose?: () => void;
}

const WINDOW = 8;
const STATUS_POLL_MS = 1000;
const START_TIMEOUT_MS = 15_000;
const STOP_GRACE_MS = 4_000;
const ACTION_POLL_MS = 350;

/**
 * `/channels` — configure + run communication channels (Slack, Telegram) on
 * their OWN dedicated, DETACHED runner without leaving the chat. A channel
 * started here keeps serving after the TUI exits and is discovered/stopped
 * process-independently via its status file (the same mechanism the desktop
 * "Channels" panel and `moxxy channels` use).
 *
 * Two views: a list (status + start/stop) and an inline config form that writes
 * each channel's secrets to the vault. Esc closes the list / returns from config.
 */
export const ChannelsPanel: React.FC<ChannelsPanelProps> = ({ channels, vault, onClose }) => {
  const rows = React.useMemo(
    () => channels.filter((c) => c.config).sort((a, b) => a.name.localeCompare(b.name)),
    [channels],
  );

  const [statuses, setStatuses] = React.useState<Record<string, ChannelRunStatus | null>>({});
  const [configured, setConfigured] = React.useState<Record<string, boolean>>({});
  const [status, setStatus] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Config sub-view. `editing` non-null ⇒ the form is open for that channel.
  const [editing, setEditing] = React.useState<ChannelDef | null>(null);
  const [fieldIdx, setFieldIdx] = React.useState(0);
  const [buffer, setBuffer] = React.useState('');
  const [savedKeys, setSavedKeys] = React.useState<Record<string, boolean>>({});

  // A one-shot poll driving a start/stop transition; cleared on unmount.
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const clearPoll = (): void => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const refreshStatuses = React.useCallback(() => {
    const next: Record<string, ChannelRunStatus | null> = {};
    for (const c of rows) next[c.name] = liveChannelStatus(c.name);
    setStatuses(next);
  }, [rows]);

  const refreshConfigured = React.useCallback(async () => {
    if (!vault) {
      setConfigured({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const c of rows) {
      const required = (c.config?.fields ?? []).filter((f) => f.required);
      let ok = true;
      for (const f of required) {
        if (!(await vault.has(f.vaultKey))) {
          ok = false;
          break;
        }
      }
      next[c.name] = ok;
    }
    setConfigured(next);
  }, [rows, vault]);

  React.useEffect(() => {
    refreshStatuses();
    void refreshConfigured();
    const t = setInterval(refreshStatuses, STATUS_POLL_MS);
    return () => {
      clearInterval(t);
      clearPoll();
    };
  }, [refreshStatuses, refreshConfigured]);

  // ── actions ───────────────────────────────────────────────────────────────

  const startChannel = React.useCallback(
    (c: ChannelDef) => {
      if (busy) return;
      if (statuses[c.name]) {
        setStatus(`${c.name} is already running.`);
        return;
      }
      // We can only enforce "configured" when we hold the vault; attached to an
      // external runner we let the channel's own boot gate decide.
      if (vault && configured[c.name] === false) {
        setStatus(`${c.name} isn't configured yet — press c to add its secrets.`);
        return;
      }
      setBusy(true);
      setStatus(`starting ${c.name}…`);
      try {
        spawnDedicatedChannel(c.name);
      } catch (err) {
        setBusy(false);
        setStatus(`failed to start ${c.name}: ${errMsg(err)}`);
        return;
      }
      const needsUrl = c.config?.hasRequestUrl === true;
      const deadline = Date.now() + START_TIMEOUT_MS;
      clearPoll();
      pollRef.current = setInterval(() => {
        const s = liveChannelStatus(c.name);
        refreshStatuses();
        if (s && (!needsUrl || s.requestUrl)) {
          clearPoll();
          setBusy(false);
          setStatus(
            s.requestUrl
              ? `✓ ${c.name} running — Request URL ready (below)`
              : `✓ ${c.name} running (pid ${s.pid})`,
          );
        } else if (Date.now() > deadline) {
          clearPoll();
          setBusy(false);
          setStatus(
            `${c.name} didn't report ready in ${START_TIMEOUT_MS / 1000}s — run \`moxxy ${c.name}\` in a terminal to see why.`,
          );
        }
      }, ACTION_POLL_MS);
    },
    [busy, statuses, configured, vault, refreshStatuses],
  );

  const stopChannel = React.useCallback(
    (c: ChannelDef) => {
      if (busy) return;
      const before = statuses[c.name];
      if (!before) {
        setStatus(`${c.name} is not running.`);
        return;
      }
      setBusy(true);
      setStatus(`stopping ${c.name}…`);
      stopDedicatedChannel(c.name);
      const deadline = Date.now() + STOP_GRACE_MS;
      clearPoll();
      pollRef.current = setInterval(() => {
        if (!liveChannelStatus(c.name)) {
          clearPoll();
          refreshStatuses();
          setBusy(false);
          setStatus(`✓ ${c.name} stopped.`);
        } else if (Date.now() > deadline) {
          clearPoll();
          // Ignored SIGTERM — hard backstop, then clear the stale file ourselves.
          if (before.pid) {
            try {
              process.kill(before.pid, 'SIGKILL');
            } catch {
              /* already gone */
            }
            clearChannelStatus(c.name);
          }
          refreshStatuses();
          setBusy(false);
          setStatus(`${c.name} force-stopped.`);
        }
      }, ACTION_POLL_MS);
    },
    [busy, statuses, refreshStatuses],
  );

  const openConfig = React.useCallback(
    (c: ChannelDef) => {
      if (!vault) {
        setStatus(
          `configuring needs a local vault — set secrets via the desktop panel or \`moxxy ${c.name} setup\`.`,
        );
        return;
      }
      void (async () => {
        const saved: Record<string, boolean> = {};
        for (const f of c.config?.fields ?? []) saved[f.vaultKey] = await vault.has(f.vaultKey);
        setSavedKeys(saved);
        setEditing(c);
        setFieldIdx(0);
        setBuffer('');
        setStatus(null);
      })();
    },
    [vault],
  );

  const saveField = React.useCallback(
    (c: ChannelDef, field: ChannelConfigField, value: string) => {
      if (!vault) return;
      const v = value.trim();
      if (!v) {
        setStatus(`(${field.label} left unchanged — type a value before Enter)`);
        return;
      }
      setBusy(true);
      void vault
        .set(field.vaultKey, v)
        .then(() => {
          setSavedKeys((s) => ({ ...s, [field.vaultKey]: true }));
          setBuffer('');
          const fields = c.config?.fields ?? [];
          if (fieldIdx + 1 < fields.length) setFieldIdx(fieldIdx + 1);
          setStatus(`✓ saved ${field.label}`);
          void refreshConfigured();
        })
        .catch((err) => setStatus(`failed to save ${field.label}: ${errMsg(err)}`))
        .finally(() => setBusy(false));
    },
    [vault, fieldIdx, refreshConfigured],
  );

  // ── list-view input ─────────────────────────────────────────────────────────

  const listActive = !editing && !busy && rows.length > 0;
  const scroll = useScrollableList({
    total: rows.length,
    windowSize: WINDOW,
    isActive: listActive,
    onSelect: (i) => {
      const c = rows[i];
      if (!c) return;
      // Smart primary: configure if unconfigured, else toggle run state.
      if (vault && configured[c.name] === false) openConfig(c);
      else if (statuses[c.name]) stopChannel(c);
      else startChannel(c);
    },
  });

  useInput(
    (input) => {
      const c = rows[scroll.cursor];
      if (!c) return;
      if (input === 's') startChannel(c);
      else if (input === 'x') stopChannel(c);
      else if (input === 'c') openConfig(c);
    },
    { isActive: listActive },
  );

  // ── config-view input ───────────────────────────────────────────────────────

  useInput(
    (input, key) => {
      if (!editing) return;
      const fields = editing.config?.fields ?? [];
      const field = fields[fieldIdx];
      if (key.escape) {
        setEditing(null);
        setBuffer('');
        setStatus(null);
        void refreshConfigured();
        return;
      }
      if (key.return) {
        if (field) saveField(editing, field, buffer);
        return;
      }
      if (key.upArrow) {
        setFieldIdx((i) => Math.max(0, i - 1));
        setBuffer('');
        return;
      }
      if (key.downArrow || key.tab) {
        setFieldIdx((i) => Math.min(fields.length - 1, i + 1));
        setBuffer('');
        return;
      }
      if (key.backspace || key.delete) {
        setBuffer((b) => b.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) setBuffer((b) => b + input);
    },
    { isActive: !!editing && !busy },
  );

  // ── render ──────────────────────────────────────────────────────────────────

  // While editing, withhold onClose so Esc returns to the list (handled above)
  // instead of closing the whole modal (Modal only owns Esc when onClose is set).
  const modalClose = editing ? undefined : onClose;

  if (editing) {
    return (
      <Modal
        title={`Configure ${editing.name}`}
        subtitle={vault ? 'secrets are stored encrypted in your vault' : undefined}
        hints="type value · Enter save · ↑↓ field · Esc back"
        {...(modalClose ? { onClose: modalClose } : {})}
      >
        <ConfigForm
          def={editing}
          fieldIdx={fieldIdx}
          buffer={buffer}
          savedKeys={savedKeys}
        />
        {status ? (
          <Box marginTop={1}>
            <Text wrap="truncate-end">{status}</Text>
          </Box>
        ) : null}
      </Modal>
    );
  }

  const subtitle =
    rows.length === 0
      ? 'none'
      : `${Math.min(scroll.cursor + 1, rows.length)} of ${rows.length}  ·  bots on their own runner`;
  const slice = rows.slice(scroll.visible.start, scroll.visible.end);

  return (
    <Modal
      title="Channels"
      subtitle={subtitle}
      hints="s start · x stop · c configure · ↑↓ navigate"
      {...(modalClose ? { onClose: modalClose } : {})}
    >
      {rows.length === 0 ? (
        <Text dimColor>(no configurable channels — the Slack / Telegram plugins aren’t loaded)</Text>
      ) : null}
      {scroll.canScrollUp ? <Text dimColor>{`  ↑ ${scroll.offset} more above`}</Text> : null}
      {slice.map((c, i) => {
        const absoluteIndex = scroll.visible.start + i;
        const focused = absoluteIndex === scroll.cursor;
        const st = statuses[c.name] ?? null;
        const running = !!st;
        const isConfigured = configured[c.name];
        return (
          <Box key={c.name} flexDirection="column">
            <Box>
              <Text {...(focused ? {} : { dimColor: true })}>{focused ? '› ' : '  '}</Text>
              <Text color={running ? Colors.active : undefined} dimColor={!running}>
                {running ? '● ' : '○ '}
              </Text>
              <Box width={12}>
                <Text bold={focused}>{c.name}</Text>
              </Box>
              <Text dimColor>{statusLabel(st, isConfigured, vault != null)}</Text>
            </Box>
            {running && st?.requestUrl ? (
              <Box marginLeft={6}>
                <Text dimColor wrap="truncate-end">{`Request URL: ${st.requestUrl}`}</Text>
              </Box>
            ) : null}
          </Box>
        );
      })}
      {scroll.canScrollDown ? (
        <Text dimColor>{`  ↓ ${rows.length - scroll.visible.end} more below`}</Text>
      ) : null}
      {status ? (
        <Box marginTop={1}>
          <Text wrap="truncate-end">{status}</Text>
        </Box>
      ) : null}
    </Modal>
  );
};

/** One-line status for a channel row. Exported for unit tests. */
export function statusLabel(
  st: ChannelRunStatus | null,
  isConfigured: boolean | undefined,
  haveVault: boolean,
): string {
  if (st) {
    const up = formatUptime(st.startedAt);
    return `running · pid ${st.pid} · up ${up}`;
  }
  if (haveVault && isConfigured === false) return 'needs config';
  if (haveVault && isConfigured) return 'ready · stopped';
  return 'stopped';
}

const ConfigForm: React.FC<{
  def: ChannelDef;
  fieldIdx: number;
  buffer: string;
  savedKeys: Record<string, boolean>;
}> = ({ def, fieldIdx, buffer, savedKeys }) => {
  const fields = def.config?.fields ?? [];
  return (
    <Box flexDirection="column">
      {fields.map((f, i) => {
        const focused = i === fieldIdx;
        const isSet = savedKeys[f.vaultKey];
        return (
          <Box key={f.vaultKey} flexDirection="column">
            <Box>
              <Text {...(focused ? {} : { dimColor: true })}>{focused ? '› ' : '  '}</Text>
              <Text color={isSet ? Colors.active : undefined} dimColor={!isSet}>
                {isSet ? '✓ ' : '◦ '}
              </Text>
              <Box width={18}>
                <Text bold={focused}>{f.label}</Text>
              </Box>
              <Text dimColor>{isSet ? 'set' : f.required ? 'required' : 'optional'}</Text>
            </Box>
            {focused ? (
              <Box marginLeft={4}>
                <Text>{'› '}</Text>
                <Text>{renderBuffer(buffer, f.secret)}</Text>
              </Box>
            ) : null}
            {focused && f.help ? (
              <Box marginLeft={4}>
                <Text dimColor wrap="truncate-end">{f.help}</Text>
              </Box>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
};

/** Masked echo for secret fields; a placeholder dot when empty so the cursor is
 *  visible. Never renders the stored value (only what the user is currently
 *  typing), so existing secrets are never shown. */
export function renderBuffer(buffer: string, secret?: boolean): string {
  if (buffer.length === 0) return ' ';
  return secret ? '•'.repeat(buffer.length) : buffer;
}

/** "12s" / "4m" / "1h 3m" since an ISO timestamp. Exported for unit tests. */
export function formatUptime(startedAt: string): string {
  const ms = Date.now() - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
