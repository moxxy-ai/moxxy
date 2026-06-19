/**
 * The PoC chat screen. Everything here that ISN'T a React Native primitive
 * comes from the SAME shared packages the desktop renderer uses —
 * `ConnectionBridge`, `ChatStoreBridge`, `useConnection`, `useChat`,
 * `useActiveWorkspaceId`, `askStore` — over the WebSocket transport. The render
 * layer is bare on purpose: the point is proving QR pairing + the shared
 * store/model/hook code path drive a live chat loop on RN, nothing more.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  FlatList,
  findNodeHandle,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { MoxxyEvent } from '@moxxy/sdk';
import { isFileDiffDisplay, type FileDiffDisplay } from '@moxxy/sdk/tool-display';
import {
  askStore,
  ChatStoreBridge,
  ConnectionBridge,
  useActiveAsk,
  useActiveWorkspaceId,
  useChat,
  useConnection,
} from '@moxxy/client-core';
import { bootMobile } from './boot';
import { FileDiffView } from './FileDiffView';

// If a URL is baked in via env, connect straight away; otherwise show the QR
// scanner so the user pairs by scanning the code `moxxy mobile` prints.
// (The env path is for simulators on this machine — no camera needed.)
//
// SECURITY: every `EXPO_PUBLIC_*` var is inlined into the JS bundle at build
// time, so a real pairing token here would ship as a recoverable literal in any
// distributable build. Gate both behind `__DEV__` so they can only ever be a
// dev/simulator shortcut and never compile into a production bundle.
const ENV_URL = __DEV__ ? process.env.EXPO_PUBLIC_MOXXY_WS_URL : undefined;
const ENV_TOKEN = __DEV__ ? process.env.EXPO_PUBLIC_MOXXY_WS_TOKEN : undefined;

export default function App(): React.JSX.Element {
  // Seed `connected` from the env URL WITHOUT a side effect — bootMobile
  // mutates global transport/platform config, so running it in the useState
  // initializer (render phase) would reconfigure on any StrictMode double-
  // invoke / remount. Do the boot once in an effect instead.
  const [connected, setConnected] = useState<boolean>(!!ENV_URL);
  useEffect(() => {
    if (ENV_URL) bootMobile(ENV_URL, ENV_TOKEN);
  }, []);

  if (!connected) {
    return (
      <ConnectScreen
        onConnect={(url) => {
          // The scanned QR embeds the token as ?t=…; bootMobile strips it from
          // the WS URL and presents it via the subprotocol bearer entry.
          bootMobile(url);
          setConnected(true);
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <ConnectionBridge />
      <ChatStoreBridge />
      <ErrorBoundary
        fallback={(retry) => (
          <View style={styles.center}>
            <Text style={styles.centerText} accessibilityLiveRegion="assertive">
              Something went wrong rendering the chat.
            </Text>
            <Pressable
              style={styles.send}
              onPress={retry}
              accessibilityRole="button"
              accessibilityLabel="Retry"
            >
              <Text style={styles.sendLabel}>Retry</Text>
            </Pressable>
          </View>
        )}
      >
        <Chat />
      </ErrorBoundary>
    </SafeAreaView>
  );
}

/**
 * Generic render error boundary. The entire transcript is attacker-influenceable
 * data forwarded from the paired runner; without this, one malformed event
 * (e.g. a file-diff with a bad hunk shape) that throws during render unmounts
 * the whole React tree to a blank screen with no recovery. Catch it, log it, and
 * render a retry affordance so a single bad payload degrades gracefully.
 */
interface ErrorBoundaryProps {
  readonly children: React.ReactNode;
  readonly fallback: (retry: () => void) => React.ReactNode;
}
interface ErrorBoundaryState {
  readonly error: Error | null;
}
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.warn('[moxxy] render error caught by boundary:', error?.message ?? error);
  }

  private readonly retry = (): void => this.setState({ error: null });

  render(): React.ReactNode {
    if (this.state.error) return this.props.fallback(this.retry);
    return this.props.children;
  }
}

/** Per-row boundary: a single malformed transcript item degrades to a one-line
 *  notice instead of taking down the whole list. */
class RowErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    console.warn('[moxxy] row render error:', error?.message ?? error);
  }

  render(): React.ReactNode {
    if (this.state.failed) {
      return (
        <View style={styles.event}>
          <Text style={styles.eventText}>⚠ Could not render this message.</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

/** Extract the host:port for a confirmation prompt. Hermes' `URL` is unreliable,
 *  so parse with a regex that ALSO rejects URLs whose authority is malformed
 *  (e.g. embedded credentials/whitespace). Returns null when no clean host is
 *  present — the caller then refuses to connect. */
function wsHost(url: string): string | null {
  const m = /^wss?:\/\/([^/?#\s@]+)(?:[/?#]|$)/i.exec(url);
  return m ? m[1]! : null;
}

/** Pair by scanning the QR `moxxy mobile` prints. */
function ConnectScreen({ onConnect }: { onConnect: (url: string) => void }): React.JSX.Element {
  const [permission, requestPermission] = useCameraPermissions();
  // The scanned URL is staged here, NOT connected: scanning is a trust boundary
  // (a malicious poster/screen QR could redirect the app to a hostile runner),
  // so require an explicit "Connect to <host>?" confirmation first.
  const [pending, setPending] = useState<{ url: string; host: string } | null>(null);

  if (!permission) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.centerText} accessibilityLiveRegion="polite">
          Preparing camera…
        </Text>
      </SafeAreaView>
    );
  }
  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.centerText}>
          Camera access is needed to scan the connection QR from `moxxy mobile`.
        </Text>
        <Pressable
          style={styles.send}
          onPress={() => void requestPermission()}
          accessibilityRole="button"
          accessibilityLabel="Grant camera access"
        >
          <Text style={styles.sendLabel}>Grant camera access</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.flex}>
      <CameraView
        style={styles.flex}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={
          pending
            ? undefined
            : ({ data }) => {
                if (typeof data !== 'string' || !/^wss?:\/\//i.test(data)) return;
                const host = wsHost(data);
                if (!host) return; // malformed authority — refuse silently
                setPending({ url: data, host });
              }
        }
      />
      <SafeAreaView style={styles.scanHint}>
        <Text style={styles.scanHintText}>Scan the QR printed by `moxxy mobile`</Text>
      </SafeAreaView>

      <ConnectConfirm
        pending={pending}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending) onConnect(pending.url);
        }}
      />
    </View>
  );
}

/** Host-confirmation sheet shown after a QR scan. Real modal a11y: aria-modal,
 *  Escape/back to cancel, focus moved to the primary action on open. */
function ConnectConfirm({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: { url: string; host: string } | null;
  onCancel: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  const connectRef = useRef<View>(null);
  // On open, move screen-reader focus onto the primary action so the sheet
  // doesn't strand focus behind the scrim (focus is restored to the camera
  // surface when the sheet unmounts).
  useEffect(() => {
    if (!pending) return undefined;
    const id = setTimeout(() => {
      const tag = connectRef.current ? findNodeHandle(connectRef.current) : null;
      if (tag != null) AccessibilityInfo.setAccessibilityFocus(tag);
    }, 50);
    return () => clearTimeout(id);
  }, [pending]);

  return (
    <Modal
      visible={!!pending}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      accessibilityViewIsModal
    >
      <View style={styles.modalScrim}>
        <View
          style={styles.modalCard}
          accessibilityViewIsModal
          accessibilityLabel="Confirm connection"
        >
          <Text style={styles.modalTitle}>Connect to this server?</Text>
          <Text style={styles.modalHost} accessibilityLabel={`Host ${pending?.host ?? ''}`}>
            {pending?.host}
          </Text>
          <Text style={styles.modalBody}>
            Only connect to a QR you printed from `moxxy mobile` on your own machine.
          </Text>
          <View style={styles.askButtons}>
            <Pressable
              style={[styles.askBtn, styles.askDeny]}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel and keep scanning"
            >
              <Text style={styles.askBtnLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              ref={connectRef}
              style={styles.askBtn}
              onPress={onConfirm}
              accessibilityRole="button"
              accessibilityLabel={`Connect to ${pending?.host ?? 'server'}`}
            >
              <Text style={styles.askBtnLabel}>Connect</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Chat(): React.JSX.Element {
  const workspaceId = useActiveWorkspaceId();
  const { snapshot } = useConnection(workspaceId);
  const { events, streamingText, sending, send } = useChat(workspaceId);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<TextInput>(null);

  const phase = snapshot?.phase.phase ?? 'connecting…';
  const ready = !!workspaceId;

  // Move focus to the composer once the chat surface becomes usable, so a
  // screen-reader / keyboard user lands on the input instead of the header.
  useEffect(() => {
    if (ready) {
      const id = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [ready]);

  // Derive the transcript projection from `events` only. Without the memo,
  // typing into the composer (local `draft` state) re-renders Chat and re-folds
  // the whole event array O(n) per keystroke for data that has not changed.
  const lines = useMemo(
    () =>
      events
        .map((event) => ({ event, line: renderLine(event) }))
        .filter((e): e is { event: MoxxyEvent; line: Line } => e.line !== null),
    [events],
  );

  const onSend = (): void => {
    // Share ONE gate with the Send button (which is disabled while `sending`):
    // the keyboard return key must not enqueue a turn the button blocks.
    if (sending) return;
    const text = draft.trim();
    if (!text || !ready) return;
    setDraft('');
    void send(text);
  };

  return (
    <View style={styles.flex}>
      <Text style={styles.status} accessibilityLiveRegion="polite" accessibilityRole="text">
        moxxy · {phase}
        {ready ? '' : ' · waiting for a workspace'}
      </Text>

      <FlatList
        style={styles.flex}
        contentContainerStyle={styles.listContent}
        data={lines}
        keyExtractor={({ event }) => event.id}
        renderItem={({ item }) => (
          <RowErrorBoundary>
            <View style={[styles.event, item.line.who === 'you' && styles.eventUser]}>
              <Text style={styles.eventWho}>{item.line.who}</Text>
              {item.line.diff ? (
                <FileDiffView display={item.line.diff} />
              ) : (
                <Text style={styles.eventText}>{item.line.text}</Text>
              )}
            </View>
          </RowErrorBoundary>
        )}
        ListFooterComponent={
          streamingText ? (
            <Text style={styles.streaming} accessibilityLiveRegion="polite">
              {streamingText}
            </Text>
          ) : null
        }
        ListEmptyComponent={<Text style={styles.empty}>No messages yet — say hello.</Text>}
      />

      <AskPrompt workspaceId={workspaceId} />

      <View style={styles.composer}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message moxxy…"
          placeholderTextColor={palette.textDim}
          editable={ready}
          onSubmitEditing={onSend}
          returnKeyType="send"
          accessibilityLabel="Message moxxy"
        />
        <Pressable
          style={[styles.send, (!ready || sending) && styles.sendDisabled]}
          disabled={!ready || sending}
          onPress={onSend}
          accessibilityRole="button"
          accessibilityState={{ disabled: !ready || sending, busy: sending }}
          accessibilityLabel={sending ? 'Sending message' : 'Send message'}
        >
          <Text style={styles.sendLabel}>{sending ? '…' : 'Send'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Permission/approval prompt — proves the ask path works over the bridge too.
 *  The interactive resolver in the host parks the runner until we respond. */
function AskPrompt({ workspaceId }: { workspaceId: string | null }): React.JSX.Element | null {
  const ask = useActiveAsk(workspaceId);
  if (!ask) return null;

  // Only forward a concrete option id. An approval ask with no usable option
  // would otherwise resolve the parked runner with optionId:'' (not a valid id)
  // and drop the ask locally, leaving the user unable to act — keep it pending.
  const allowOptionId = ask.kind === 'approval' ? ask.approval?.options[0]?.id : undefined;
  const denyOptionId =
    ask.kind === 'approval'
      ? ask.approval?.options.find((o) => o.danger)?.id ?? ask.approval?.defaultOptionId
      : undefined;

  // For a permission ask both verdicts are always forwardable; for an approval
  // ask a button is only actionable if it maps to a concrete option id.
  const canAllow = ask.kind === 'permission' || !!allowOptionId;
  const canDeny = ask.kind === 'permission' || !!denyOptionId;

  const allow = (): void => {
    if (ask.kind === 'permission') {
      askStore.respond(ask.requestId, { mode: 'allow' });
      return;
    }
    if (allowOptionId) askStore.respond(ask.requestId, { optionId: allowOptionId });
  };
  const deny = (): void => {
    if (ask.kind === 'permission') {
      askStore.respond(ask.requestId, { mode: 'deny' });
      return;
    }
    if (denyOptionId) askStore.respond(ask.requestId, { optionId: denyOptionId });
  };

  const label =
    ask.kind === 'permission' ? `Allow tool "${ask.tool?.name}"?` : 'Approval requested';
  // Make the dead-end visible rather than a silent no-op tap.
  const unanswerable = !canAllow && !canDeny;

  return (
    <View style={styles.ask} accessibilityLiveRegion="polite">
      <Text style={styles.askLabel}>{label}</Text>
      {unanswerable ? (
        <Text style={styles.askNotice}>This approval can&apos;t be answered from mobile.</Text>
      ) : null}
      <View style={styles.askButtons}>
        <Pressable
          style={[styles.askBtn, !canAllow && styles.sendDisabled]}
          onPress={allow}
          disabled={!canAllow}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canAllow }}
          accessibilityLabel={label === 'Approval requested' ? 'Approve' : 'Allow'}
        >
          <Text style={styles.askBtnLabel}>Allow</Text>
        </Pressable>
        <Pressable
          style={[styles.askBtn, styles.askDeny, !canDeny && styles.sendDisabled]}
          onPress={deny}
          disabled={!canDeny}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canDeny }}
          accessibilityLabel="Deny"
        >
          <Text style={styles.askBtnLabel}>Deny</Text>
        </Pressable>
      </View>
    </View>
  );
}

interface Line {
  readonly who: 'you' | 'moxxy' | 'tool' | 'error';
  readonly text: string;
  /** When set, render a diff card instead of the one-line `text` fallback. */
  readonly diff?: FileDiffDisplay;
}

/** Human-readable line for the transcript-bearing events; null skips the rest
 *  (chunks ride `streamingText`, provider/plugin noise stays off a PoC screen). */
function renderLine(event: MoxxyEvent): Line | null {
  switch (event.type) {
    case 'user_prompt':
      return { who: 'you', text: event.text };
    case 'assistant_message':
      return event.content.trim() ? { who: 'moxxy', text: event.content } : null;
    case 'tool_call_requested':
      return { who: 'tool', text: `→ ${event.name}` };
    case 'tool_result': {
      // Write/Edit results carry `output: { forModel, display }`; when the
      // display is a file-diff, render it as a card (see FileDiffView).
      const display = (event.output as { display?: unknown } | undefined)?.display;
      if (event.ok && isFileDiffDisplay(display)) {
        return { who: 'tool', text: '', diff: display };
      }
      return { who: 'tool', text: event.ok ? '✓ done' : `✗ ${event.error?.message ?? 'failed'}` };
    }
    case 'error':
      return { who: 'error', text: event.message };
    default:
      return null;
  }
}

const palette = {
  appBg: '#101014',
  cardBg: '#1a1a21',
  border: '#2a2a33',
  text: '#f2f2f5',
  textMuted: '#b7b7c2',
  // Raised from #6f6f7c so secondary labels / empty-state clear WCAG AA on the
  // dark surfaces; still visibly dimmer than `textMuted`.
  textDim: '#9a9aa6',
  primary: '#6c5ce7',
  primarySoft: '#27243d',
  red: '#d63a4f',
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.appBg },
  flex: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
    backgroundColor: palette.appBg,
  },
  centerText: { color: palette.text, textAlign: 'center', fontSize: 16 },
  scanHint: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', padding: 16 },
  scanHintText: {
    color: '#ffffff',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  status: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: palette.text,
    fontWeight: '600',
    backgroundColor: palette.cardBg,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  listContent: { padding: 12, gap: 8 },
  event: {
    backgroundColor: palette.cardBg,
    borderRadius: 10,
    padding: 10,
    gap: 2,
  },
  eventUser: { backgroundColor: palette.primarySoft },
  eventWho: { color: palette.textDim, fontSize: 11, textTransform: 'uppercase' },
  eventText: { color: palette.text, fontSize: 14 },
  streaming: { color: palette.textMuted, fontStyle: 'italic', padding: 10 },
  empty: { color: palette.textDim, textAlign: 'center', marginTop: 40 },
  composer: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    backgroundColor: palette.cardBg,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: palette.text,
  },
  send: {
    backgroundColor: palette.primary,
    borderRadius: 12,
    paddingHorizontal: 18,
    minHeight: 44, // 44x44 minimum hit target
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendDisabled: { opacity: 0.5 },
  sendLabel: { color: '#ffffff', fontWeight: '700' },
  ask: {
    margin: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: palette.primarySoft,
    borderWidth: 1,
    borderColor: palette.primary,
    gap: 8,
  },
  askLabel: { color: palette.text, fontWeight: '600' },
  askNotice: { color: palette.textMuted, fontSize: 12 },
  askButtons: { flexDirection: 'row', gap: 8 },
  askBtn: {
    flex: 1,
    backgroundColor: palette.primary,
    borderRadius: 10,
    paddingVertical: 12,
    minHeight: 44, // 44x44 minimum hit target
    alignItems: 'center',
    justifyContent: 'center',
  },
  askDeny: { backgroundColor: palette.red },
  askBtnLabel: { color: '#ffffff', fontWeight: '700' },
  modalScrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: palette.cardBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 20,
    gap: 10,
  },
  modalTitle: { color: palette.text, fontSize: 17, fontWeight: '700' },
  modalHost: { color: palette.primary, fontSize: 15, fontWeight: '700' },
  modalBody: { color: palette.textMuted, fontSize: 13 },
});
