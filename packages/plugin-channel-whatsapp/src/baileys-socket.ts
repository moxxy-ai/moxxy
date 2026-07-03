import { createWhatsAppAuthState, type BaileysAuthBridge } from './auth-state.js';
import type {
  WaConnectionUpdate,
  WaMessageKey,
  WaMessagesUpsert,
  WaSentMessage,
  WhatsAppSocket,
  WhatsAppSocketFactory,
  WhatsAppSocketLogger,
} from './socket.js';

/**
 * The production {@link WhatsAppSocketFactory}: lazily imports Baileys (a heavy
 * dependency tree — protobufjs, libsignal — that must NOT load at plugin
 * discovery time, only when the channel actually starts; same lesson as the
 * desktop-host eager-import boot crash), builds the swappable auth state, and
 * adapts the socket down to the narrow contract the channel uses.
 */
export const openBaileysSocket: WhatsAppSocketFactory = async ({ storage, logger }) => {
  const baileys = (await import('@whiskeysockets/baileys')) as unknown as BaileysModule;
  const makeWASocket = baileys.makeWASocket ?? baileys.default?.makeWASocket ?? baileys.default;
  if (typeof makeWASocket !== 'function') {
    throw new Error('@whiskeysockets/baileys: could not resolve makeWASocket export');
  }
  const proto = baileys.proto ?? baileys.default?.proto;
  const bridge: BaileysAuthBridge = {
    initAuthCreds: baileys.initAuthCreds,
    BufferJSON: baileys.BufferJSON,
    ...(proto?.Message?.AppStateSyncKeyData
      ? {
          reviveAppStateSyncKey: (value: unknown) =>
            proto.Message!.AppStateSyncKeyData!.fromObject(value as Record<string, unknown>),
        }
      : {}),
  };
  const { state, saveCreds } = await createWhatsAppAuthState(storage, bridge);

  const sock = makeWASocket({
    auth: state as never,
    // The channel renders the QR itself (terminal QR / desktop panel status file).
    printQRInTerminal: false,
    logger: silentBaileysLogger() as never,
    // Don't mark the linked device "online": keeps phone notifications working
    // and keeps this client's footprint minimal (it is a bot, not a presence).
    markOnlineOnConnect: false,
    // No history backfill — the channel only reacts to live inbound messages;
    // syncing message history would be both wasteful and a privacy liability.
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    generateHighQualityLinkPreview: false,
    browser: ['moxxy', 'Desktop', '1.0.0'],
  });
  sock.ev.on('creds.update', () => {
    void saveCreds().catch((err: unknown) => {
      logger?.warn?.('whatsapp: failed to persist creds update', { err: String(err) });
    });
  });

  return adaptBaileysSocket(sock, baileys, logger);
};

function adaptBaileysSocket(
  sock: BaileysSock,
  baileys: BaileysModule,
  logger?: WhatsAppSocketLogger,
): WhatsAppSocket {
  const downloadMediaMessage =
    baileys.downloadMediaMessage ?? baileys.default?.downloadMediaMessage;
  return {
    userJid: () => sock.user?.id ?? null,
    onConnectionUpdate: (cb) =>
      sock.ev.on('connection.update', (u: unknown) => cb(u as WaConnectionUpdate)),
    onMessages: (cb) =>
      sock.ev.on('messages.upsert', (u: unknown) => cb(u as WaMessagesUpsert)),
    sendText: async (jid, text) => {
      const sent = (await sock.sendMessage(jid, { text })) as { key?: WaMessageKey } | undefined;
      return sent?.key ? ({ key: sent.key } satisfies WaSentMessage) : null;
    },
    editText: async (jid, key, text) => {
      await sock.sendMessage(jid, { text, edit: key });
    },
    downloadMedia: async (message) => {
      if (typeof downloadMediaMessage !== 'function') {
        throw new Error('@whiskeysockets/baileys: downloadMediaMessage export missing');
      }
      const buf = (await downloadMediaMessage(
        message as never,
        'buffer',
        {},
        { logger: silentBaileysLogger() as never, reuploadRequest: sock.updateMediaMessage },
      )) as Buffer;
      return new Uint8Array(buf);
    },
    end: () => {
      try {
        sock.end(undefined);
      } catch (err) {
        logger?.debug?.('whatsapp: socket end threw', { err: String(err) });
      }
    },
  };
}

/** Minimal Baileys ILogger that swallows everything (moxxy has its own logger). */
function silentBaileysLogger(): Record<string, unknown> {
  const noop = (): void => undefined;
  const self: Record<string, unknown> = {
    level: 'silent',
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
  };
  self.child = () => self;
  return self;
}

// ---- Loosely-typed view of the dynamically imported module (the real types
// stay out so this file compiles without deep Baileys type coupling; the
// adapter boundary above is the single place the erasure happens). ----

interface BaileysSock {
  readonly user?: { id: string } | undefined;
  readonly ev: { on(event: string, cb: (arg: never) => void): void };
  sendMessage(jid: string, content: Record<string, unknown>): Promise<unknown>;
  updateMediaMessage: unknown;
  end(err: Error | undefined): void;
}

interface BaileysModule {
  makeWASocket?: (config: Record<string, unknown>) => BaileysSock;
  initAuthCreds: () => Record<string, unknown>;
  BufferJSON: BaileysAuthBridge['BufferJSON'];
  downloadMediaMessage?: (
    message: never,
    type: 'buffer',
    options: Record<string, unknown>,
    ctx: Record<string, unknown>,
  ) => Promise<Buffer>;
  proto?: BaileysProto;
  default?: {
    makeWASocket?: (config: Record<string, unknown>) => BaileysSock;
    downloadMediaMessage?: BaileysModule['downloadMediaMessage'];
    proto?: BaileysProto;
  } & ((config: Record<string, unknown>) => BaileysSock);
}

interface BaileysProto {
  Message?: {
    AppStateSyncKeyData?: { fromObject(value: Record<string, unknown>): unknown };
  };
}
