import type { WhatsAppAuthStorage } from './auth-state.js';

/**
 * The narrow transport contract the channel is written against — the slice of a
 * Baileys socket it actually touches, adapted in `baileys-socket.ts`. Tests
 * inject a fake implementing THIS, so no test ever opens a WhatsApp connection
 * (and the heavyweight Baileys import stays out of unit tests entirely).
 */

export interface WaMessageKey {
  readonly remoteJid?: string | null;
  readonly fromMe?: boolean | null;
  readonly id?: string | null;
  readonly participant?: string | null;
}

/** The consumed subset of a Baileys `WAMessage` (validated in message-gate). */
export interface WaInboundMessage {
  readonly key?: WaMessageKey | null;
  readonly message?: Record<string, unknown> | null;
}

export interface WaMessagesUpsert {
  /** 'notify' = fresh inbound; 'append'/'history' = sync artifacts (dropped). */
  readonly type: string;
  readonly messages: ReadonlyArray<WaInboundMessage>;
}

export interface WaConnectionUpdate {
  readonly connection?: 'close' | 'connecting' | 'open' | undefined;
  /** Fresh QR pairing payload — rotates every ~20-60s while unlinked. */
  readonly qr?: string | undefined;
  readonly lastDisconnect?: { readonly error?: unknown } | undefined;
}

export interface WaSentMessage {
  readonly key: WaMessageKey;
}

export interface WhatsAppSocket {
  /** The linked account's raw JID once the connection is open; null before. */
  userJid(): string | null;
  onConnectionUpdate(cb: (update: WaConnectionUpdate) => void): void;
  onMessages(cb: (upsert: WaMessagesUpsert) => void): void;
  sendText(jid: string, text: string): Promise<WaSentMessage | null>;
  /** Edit a previously sent message in place (WhatsApp MESSAGE_EDIT). */
  editText(jid: string, key: WaMessageKey, text: string): Promise<void>;
  /** Download a media message's bytes (voice notes). */
  downloadMedia(message: WaInboundMessage): Promise<Uint8Array>;
  /** Tear the connection down WITHOUT logging out (creds stay valid). */
  end(): void;
}

export interface WhatsAppSocketLogger {
  debug?(msg: string, meta?: Record<string, unknown>): void;
  info?(msg: string, meta?: Record<string, unknown>): void;
  warn?(msg: string, meta?: Record<string, unknown>): void;
}

export interface WhatsAppSocketFactoryOptions {
  readonly storage: WhatsAppAuthStorage;
  readonly logger?: WhatsAppSocketLogger;
}

/** Opens one connection attempt; the channel owns the reconnect loop. */
export type WhatsAppSocketFactory = (
  opts: WhatsAppSocketFactoryOptions,
) => Promise<WhatsAppSocket>;

/**
 * Extract the WhatsApp disconnect status code from a close error (Baileys
 * throws Boom errors: `err.output.statusCode`). Pure so the reconnect policy is
 * unit-testable. Returns null when no code can be found (treated as retriable).
 */
export function disconnectStatusCode(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;
  const output = (err as { output?: unknown }).output;
  if (typeof output !== 'object' || output === null) return null;
  const code = (output as { statusCode?: unknown }).statusCode;
  return typeof code === 'number' && Number.isFinite(code) ? code : null;
}

/** WhatsApp disconnect reasons the channel branches on (Baileys' DisconnectReason). */
export const WA_DISCONNECT = {
  loggedOut: 401,
  forbidden: 403,
  connectionReplaced: 440,
  restartRequired: 515,
} as const;
