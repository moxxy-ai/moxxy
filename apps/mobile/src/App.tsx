/**
 * The PoC chat screen. Everything here that ISN'T a React Native primitive comes
 * from the SAME shared packages the desktop renderer uses — `ConnectionBridge`,
 * `ChatStoreBridge`, `useConnection`, `useChat`, `useActiveWorkspaceId` — over a
 * WebSocket transport. The render layer is bare on purpose: the point is that the
 * shared store/model/hook code path drives a live chat loop unchanged on RN.
 */

import { useState } from 'react';
import {
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { MoxxyEvent } from '@moxxy/sdk';
import { tokens } from '@moxxy/design-tokens';
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

// If a URL is baked in via env, connect straight away; otherwise show the QR
// scanner so the user pairs by scanning the code `moxxy mobile` prints.
const ENV_URL = process.env.EXPO_PUBLIC_MOXXY_WS_URL;
const ENV_TOKEN = process.env.EXPO_PUBLIC_MOXXY_WS_TOKEN;

export default function App(): JSX.Element {
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
          bootMobile(url); // token is embedded in the scanned URL (?t=…)
          setConnected(true);
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <ConnectionBridge />
      <ChatStoreBridge />
      <Chat />
    </SafeAreaView>
  );
}

/** Pair by scanning the QR `moxxy mobile` (or the desktop bridge) prints. */
function ConnectScreen({ onConnect }: { onConnect: (url: string) => void }): JSX.Element {
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

function Chat(): JSX.Element {
  const workspaceId = useActiveWorkspaceId();
  const { snapshot } = useConnection(workspaceId);
  const { events, streamingText, sending, send } = useChat(workspaceId);
  const [draft, setDraft] = useState('');

  const phase = snapshot?.phase.phase ?? 'connecting…';
  const ready = !!workspaceId;

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
        data={events}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item }) => <Text style={styles.event}>{summarize(item)}</Text>}
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
          placeholderTextColor={tokens.color.textDim}
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
function AskPrompt({ workspaceId }: { workspaceId: string | null }): JSX.Element | null {
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
        optionId: ask.approval?.options.find((o) => o.danger)?.id ?? ask.approval?.defaultOptionId ?? '',
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

/** Compact one-line view of a runner event (the bare PoC render). */
function summarize(event: MoxxyEvent): string {
  const json = JSON.stringify(event);
  return json.length > 200 ? `${json.slice(0, 200)}…` : json;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.color.appBg },
  flex: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
    backgroundColor: tokens.color.appBg,
  },
  centerText: { color: tokens.color.text, textAlign: 'center', fontSize: 16 },
  scanHint: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', padding: 16 },
  scanHintText: {
    color: '#ffffff',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: tokens.radius.pill,
    overflow: 'hidden',
  },
  status: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: tokens.color.text,
    fontWeight: '600',
    backgroundColor: tokens.color.cardBg,
    borderBottomWidth: 1,
    borderBottomColor: tokens.color.cardBorder,
  },
  listContent: { padding: 12, gap: 8 },
  event: {
    color: tokens.color.text,
    fontSize: 12,
    backgroundColor: tokens.color.cardBg,
    borderRadius: tokens.radius.block,
    padding: 10,
  },
  streaming: { color: tokens.color.textMuted, fontStyle: 'italic', padding: 10 },
  empty: { color: tokens.color.textDim, textAlign: 'center', marginTop: 40 },
  composer: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: tokens.color.cardBorder,
    backgroundColor: tokens.color.cardBg,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: tokens.color.cardBorderStrong,
    borderRadius: tokens.radius.card,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: tokens.color.text,
  },
  send: {
    backgroundColor: tokens.color.primary,
    borderRadius: tokens.radius.card,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.5 },
  sendLabel: { color: '#ffffff', fontWeight: '700' },
  ask: {
    margin: 12,
    padding: 12,
    borderRadius: tokens.radius.card,
    backgroundColor: tokens.color.primarySoft,
    borderWidth: 1,
    borderColor: tokens.color.primary,
    gap: 8,
  },
  askLabel: { color: tokens.color.text, fontWeight: '600' },
  askButtons: { flexDirection: 'row', gap: 8 },
  askBtn: {
    flex: 1,
    backgroundColor: tokens.color.primary,
    borderRadius: tokens.radius.block,
    paddingVertical: 10,
    alignItems: 'center',
  },
  askDeny: { backgroundColor: tokens.color.red },
  askBtnLabel: { color: '#ffffff', fontWeight: '700' },
});
