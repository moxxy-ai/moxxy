/**
 * The PoC chat screen. Everything here that ISN'T a React Native primitive
 * comes from the SAME shared packages the desktop renderer uses —
 * `ConnectionBridge`, `ChatStoreBridge`, `useConnection`, `useChat`,
 * `useActiveWorkspaceId`, `askStore` — over the WebSocket transport. The render
 * layer is bare on purpose: the point is proving QR pairing + the shared
 * store/model/hook code path drive a live chat loop on RN, nothing more.
 */

import React, { useState } from 'react';
import {
  FlatList,
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
const ENV_URL = process.env.EXPO_PUBLIC_MOXXY_WS_URL;
const ENV_TOKEN = process.env.EXPO_PUBLIC_MOXXY_WS_TOKEN;

export default function App(): React.JSX.Element {
  const [connected, setConnected] = useState<boolean>(() => {
    if (ENV_URL) {
      bootMobile(ENV_URL, ENV_TOKEN);
      return true;
    }
    return false;
  });

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
      <Chat />
    </SafeAreaView>
  );
}

/** Pair by scanning the QR `moxxy mobile` prints. */
function ConnectScreen({ onConnect }: { onConnect: (url: string) => void }): React.JSX.Element {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  if (!permission) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.centerText}>Preparing camera…</Text>
      </SafeAreaView>
    );
  }
  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.centerText}>
          Camera access is needed to scan the connection QR from `moxxy mobile`.
        </Text>
        <Pressable style={styles.send} onPress={() => void requestPermission()}>
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
          scanned
            ? undefined
            : ({ data }) => {
                if (/^wss?:\/\//i.test(data)) {
                  setScanned(true);
                  onConnect(data);
                }
              }
        }
      />
      <SafeAreaView style={styles.scanHint}>
        <Text style={styles.scanHintText}>Scan the QR printed by `moxxy mobile`</Text>
      </SafeAreaView>
    </View>
  );
}

function Chat(): React.JSX.Element {
  const workspaceId = useActiveWorkspaceId();
  const { snapshot } = useConnection(workspaceId);
  const { events, streamingText, sending, send } = useChat(workspaceId);
  const [draft, setDraft] = useState('');

  const phase = snapshot?.phase.phase ?? 'connecting…';
  const ready = !!workspaceId;
  const lines = events
    .map((event) => ({ event, line: renderLine(event) }))
    .filter((e): e is { event: MoxxyEvent; line: Line } => e.line !== null);

  const onSend = (): void => {
    const text = draft.trim();
    if (!text || !ready) return;
    setDraft('');
    void send(text);
  };

  return (
    <View style={styles.flex}>
      <Text style={styles.status}>
        moxxy · {phase}
        {ready ? '' : ' · waiting for a workspace'}
      </Text>

      <FlatList
        style={styles.flex}
        contentContainerStyle={styles.listContent}
        data={lines}
        keyExtractor={({ event }) => event.id}
        renderItem={({ item }) => (
          <View style={[styles.event, item.line.who === 'you' && styles.eventUser]}>
            <Text style={styles.eventWho}>{item.line.who}</Text>
            {item.line.diff ? (
              <FileDiffView display={item.line.diff} />
            ) : (
              <Text style={styles.eventText}>{item.line.text}</Text>
            )}
          </View>
        )}
        ListFooterComponent={
          streamingText ? <Text style={styles.streaming}>{streamingText}</Text> : null
        }
        ListEmptyComponent={<Text style={styles.empty}>No messages yet — say hello.</Text>}
      />

      <AskPrompt workspaceId={workspaceId} />

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message moxxy…"
          placeholderTextColor={palette.textDim}
          editable={ready}
          onSubmitEditing={onSend}
          returnKeyType="send"
        />
        <Pressable
          style={[styles.send, (!ready || sending) && styles.sendDisabled]}
          disabled={!ready || sending}
          onPress={onSend}
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

  const allow = (): void => {
    if (ask.kind === 'permission') askStore.respond(ask.requestId, { mode: 'allow' });
    else askStore.respond(ask.requestId, { optionId: ask.approval?.options[0]?.id ?? '' });
  };
  const deny = (): void => {
    if (ask.kind === 'permission') askStore.respond(ask.requestId, { mode: 'deny' });
    else
      askStore.respond(ask.requestId, {
        optionId:
          ask.approval?.options.find((o) => o.danger)?.id ?? ask.approval?.defaultOptionId ?? '',
      });
  };

  const label =
    ask.kind === 'permission' ? `Allow tool "${ask.tool?.name}"?` : 'Approval requested';

  return (
    <View style={styles.ask}>
      <Text style={styles.askLabel}>{label}</Text>
      <View style={styles.askButtons}>
        <Pressable style={styles.askBtn} onPress={allow}>
          <Text style={styles.askBtnLabel}>Allow</Text>
        </Pressable>
        <Pressable style={[styles.askBtn, styles.askDeny]} onPress={deny}>
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
  textDim: '#6f6f7c',
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
    justifyContent: 'center',
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
  askButtons: { flexDirection: 'row', gap: 8 },
  askBtn: {
    flex: 1,
    backgroundColor: palette.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  askDeny: { backgroundColor: palette.red },
  askBtnLabel: { color: '#ffffff', fontWeight: '700' },
});
