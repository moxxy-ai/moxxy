import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Session, autoAllowResolver, silentLogger } from '@moxxy/core';
import { FakeProvider, streamingTextReply } from '@moxxy/testing';
import { definePlugin, defineProvider, defineTranscriber } from '@moxxy/sdk';
import { defaultModePlugin } from '@moxxy/mode-default';
import { VaultStore, createStaticKeySource, deriveKey, generateSalt } from '@moxxy/plugin-vault';
import { WhatsAppChannel } from './channel.js';
import type {
  WaConnectionUpdate,
  WaInboundMessage,
  WaMessageKey,
  WaMessagesUpsert,
  WhatsAppSocket,
  WhatsAppSocketFactoryOptions,
} from './socket.js';
import { createFileAuthStorage } from './auth-state.js';
import { WHATSAPP_CONSENT_ENV } from './keys.js';

const OWNER = '15550000000@s.whatsapp.net';
const FRIEND = '15551111111@s.whatsapp.net';
const STRANGER = '15559999999@s.whatsapp.net';

interface SentRecord {
  jid: string;
  text: string;
}

/** Scriptable in-memory WhatsApp socket — no network, no Baileys. */
class FakeSocket implements WhatsAppSocket {
  connCb: ((u: WaConnectionUpdate) => void) | null = null;
  msgCb: ((u: WaMessagesUpsert) => void) | null = null;
  readonly sent: SentRecord[] = [];
  readonly edits: Array<{ jid: string; id: string; text: string }> = [];
  private jid: string | null = null;
  private seq = 0;
  downloadImpl: (m: WaInboundMessage) => Promise<Uint8Array> = async () => new Uint8Array();
  ended = false;

  userJid(): string | null {
    return this.jid;
  }
  onConnectionUpdate(cb: (u: WaConnectionUpdate) => void): void {
    this.connCb = cb;
  }
  onMessages(cb: (u: WaMessagesUpsert) => void): void {
    this.msgCb = cb;
  }
  async sendText(jid: string, text: string): Promise<{ key: WaMessageKey } | null> {
    const id = `out-${++this.seq}`;
    this.sent.push({ jid, text });
    return { key: { remoteJid: jid, fromMe: true, id } };
  }
  async editText(jid: string, key: WaMessageKey, text: string): Promise<void> {
    this.edits.push({ jid, id: key.id ?? '', text });
  }
  async downloadMedia(m: WaInboundMessage): Promise<Uint8Array> {
    return this.downloadImpl(m);
  }
  end(): void {
    this.ended = true;
  }

  // ---- test drivers ----
  open(jid: string): void {
    this.jid = jid;
    this.connCb?.({ connection: 'open' });
  }
  qr(payload: string): void {
    this.connCb?.({ qr: payload });
  }
  close(err?: unknown): void {
    this.connCb?.({ connection: 'close', lastDisconnect: err ? { error: err } : undefined });
  }
  inbound(message: WaInboundMessage, type = 'notify'): void {
    this.msgCb?.({ type, messages: [message] });
  }
}

function textMsg(remoteJid: string, text: string, fromMe = false, id = `in-${Math.random()}`): WaInboundMessage {
  return { key: { remoteJid, fromMe, id }, message: { conversation: text } };
}

let tmp: string;
let vault: VaultStore;
let session: Session;
let provider: FakeProvider;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-wa-chan-'));
  process.env[WHATSAPP_CONSENT_ENV] = 'yes';
  vault = new VaultStore({
    filePath: path.join(tmp, 'vault.json'),
    keySource: createStaticKeySource(deriveKey('test', generateSalt())),
  });
  provider = new FakeProvider({ script: [streamingTextReply(['Hello ', 'world'])] });
  session = new Session({ cwd: tmp, logger: silentLogger, permissionResolver: autoAllowResolver });
  session.pluginHost.registerStatic(
    definePlugin({
      name: 'shim',
      providers: [
        defineProvider({ name: provider.name, models: [...provider.models], createClient: () => provider }),
      ],
    }),
  );
  session.providers.setActive(provider.name);
  session.pluginHost.registerStatic(defaultModePlugin);
});

afterEach(async () => {
  await session.close('test').catch(() => undefined);
  // The Baileys auth dir may still be mid-write from a socket that just closed;
  // a single rm can race it (ENOTEMPTY). Retry briefly, then give up.
  for (let i = 0; i < 5; i++) {
    try {
      await fs.rm(tmp, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  delete process.env[WHATSAPP_CONSENT_ENV];
});

function makeChannel(fake: FakeSocket, opts: Partial<{ allowedJids: string[] }> = {}): WhatsAppChannel {
  return new WhatsAppChannel({
    vault,
    editFrameMs: 5,
    socketFactory: async (_o: WhatsAppSocketFactoryOptions) => fake,
    // Pre-seeded creds file so start() doesn't demand pair mode.
    authStorage: seededStorage(),
    ...(opts.allowedJids ? { allowedJids: opts.allowedJids } : {}),
  });
}

/** A storage with a creds record present (simulates an already-linked account). */
function seededStorage() {
  const storage = createFileAuthStorage(path.join(tmp, 'auth'));
  return {
    ...storage,
    read: async (k: string) => (k === 'creds' ? '{"me":1}' : storage.read(k)),
  };
}

describe('WhatsAppChannel.start', () => {
  it('refuses to start without consent', async () => {
    delete process.env[WHATSAPP_CONSENT_ENV];
    const channel = makeChannel(new FakeSocket());
    session.setPermissionResolver(channel.permissionResolver);
    await expect(channel.start({ session, dedicated: true })).rejects.toThrow(/ToS|acknowledg|ban/i);
  });

  it('refuses to start unlinked outside pair mode', async () => {
    const fake = new FakeSocket();
    const channel = new WhatsAppChannel({
      vault,
      socketFactory: async () => fake,
      authStorage: createFileAuthStorage(path.join(tmp, 'empty-auth')),
    });
    session.setPermissionResolver(channel.permissionResolver);
    await expect(channel.start({ session })).rejects.toThrow(/No WhatsApp account is linked/);
  });

  it('drives a full turn for the owner Note-to-Self chat and streams via edits', async () => {
    const fake = new FakeSocket();
    const channel = makeChannel(fake);
    session.setPermissionResolver(channel.permissionResolver);
    const handle = await channel.start({ session });
    fake.open(OWNER);

    fake.inbound(textMsg(OWNER, 'hi', true));
    await vi.waitFor(() => {
      const all = [...fake.sent.map((s) => s.text), ...fake.edits.map((e) => e.text)];
      expect(all.join('')).toContain('Hello world');
    });
    expect(channel.connected).toBe(true);
    await handle.stop('test done');
  });

  it('runs a turn for an allow-listed friend', async () => {
    const fake = new FakeSocket();
    const channel = makeChannel(fake, { allowedJids: [FRIEND] });
    session.setPermissionResolver(channel.permissionResolver);
    const handle = await channel.start({ session });
    fake.open(OWNER);

    fake.inbound(textMsg(FRIEND, 'hey bot'));
    await vi.waitFor(() => expect(provider.received.length).toBeGreaterThan(0));
    await handle.stop('test done');
  });

  it('drops an un-allow-listed stranger with no reply', async () => {
    const fake = new FakeSocket();
    const channel = makeChannel(fake);
    session.setPermissionResolver(channel.permissionResolver);
    const handle = await channel.start({ session });
    fake.open(OWNER);

    fake.inbound(textMsg(STRANGER, 'let me in'));
    // Give the async dispatch a tick; nothing should be sent, no turn should run.
    await new Promise((r) => setTimeout(r, 20));
    expect(provider.received.length).toBe(0);
    expect(fake.sent).toHaveLength(0);
    await handle.stop('test done');
  });

  it('does NOT reprocess its own outbound echo (loop protection)', async () => {
    const fake = new FakeSocket();
    const channel = makeChannel(fake);
    session.setPermissionResolver(channel.permissionResolver);
    const handle = await channel.start({ session });
    fake.open(OWNER);

    fake.inbound(textMsg(OWNER, 'hi', true));
    await vi.waitFor(() => expect(fake.sent.length + fake.edits.length).toBeGreaterThan(0));
    const turnsBefore = provider.received.length;

    // Feed the channel's own last send back as an inbound (fromMe echo).
    const lastOut = fake.sent[fake.sent.length - 1]!;
    // Reconstruct the outbound key id: the fake numbers them out-N; grab it via
    // a fresh send to learn the id shape isn't needed — echo by a known own id.
    fake.inbound({ key: { remoteJid: OWNER, fromMe: true, id: 'out-1' }, message: { conversation: lastOut.text } });
    await new Promise((r) => setTimeout(r, 20));
    expect(provider.received.length).toBe(turnsBefore);
    await handle.stop('test done');
  });

  it('transcribes a voice note through the active transcriber, then runs a turn', async () => {
    // Register a stub transcriber on the session, then activate it.
    session.pluginHost.registerStatic(
      definePlugin({
        name: 'stub-stt',
        transcribers: [
          defineTranscriber({
            name: 'stub',
            createClient: () => ({
              name: 'stub',
              transcribe: async () => ({ text: 'transcribed prompt' }),
            }),
          }),
        ],
      }),
    );
    session.transcribers.setActive('stub');

    const fake = new FakeSocket();
    fake.downloadImpl = async () => new Uint8Array([1, 2, 3]);
    const channel = makeChannel(fake);
    session.setPermissionResolver(channel.permissionResolver);
    const handle = await channel.start({ session });
    fake.open(OWNER);

    fake.inbound({
      key: { remoteJid: OWNER, fromMe: true, id: 'v1' },
      message: { audioMessage: { mimetype: 'audio/ogg', fileLength: 3, ptt: true } },
    });
    await vi.waitFor(() => {
      expect(fake.sent.some((s) => s.text.includes('heard: transcribed prompt'))).toBe(true);
    });
    await vi.waitFor(() => expect(provider.received.length).toBeGreaterThan(0));
    await handle.stop('test done');
  });

  it('guides the user when a voice note arrives with no transcriber', async () => {
    const fake = new FakeSocket();
    fake.downloadImpl = async () => new Uint8Array([1]);
    const channel = makeChannel(fake);
    session.setPermissionResolver(channel.permissionResolver);
    const handle = await channel.start({ session });
    fake.open(OWNER);

    fake.inbound({
      key: { remoteJid: OWNER, fromMe: true, id: 'v2' },
      message: { audioMessage: { mimetype: 'audio/ogg', fileLength: 1 } },
    });
    await vi.waitFor(() => {
      expect(fake.sent.some((s) => /speech-to-text/i.test(s.text))).toBe(true);
    });
    expect(provider.received.length).toBe(0);
    await handle.stop('test done');
  });

  it('publishes rotating QR payloads as requestUrl in pair mode', async () => {
    const fake = new FakeSocket();
    const channel = new WhatsAppChannel({
      vault,
      socketFactory: async () => fake,
      authStorage: createFileAuthStorage(path.join(tmp, 'pair-auth')),
    });
    session.setPermissionResolver(channel.permissionResolver);
    const handle = await channel.start({ session, pair: true });
    expect(channel.connected).toBe(false);

    let changes = 0;
    handle.onConnectChange?.(() => changes++);
    fake.qr('qr-payload-1');
    expect(channel.requestUrl).toBe('qr-payload-1');
    expect(changes).toBe(1);

    // Linking clears the QR and flips connected.
    fake.open(OWNER);
    expect(channel.requestUrl).toBeNull();
    expect(channel.connected).toBe(true);
    await handle.stop('test done');
  });

  it('stop() aborts pending permission prompts (no hang)', async () => {
    const fake = new FakeSocket();
    const channel = makeChannel(fake);
    session.setPermissionResolver(channel.permissionResolver);
    const handle = await channel.start({ session });
    fake.open(OWNER);
    // Set a chat as "last served" so the prompt has a target.
    fake.inbound(textMsg(OWNER, 'hi', true));
    await vi.waitFor(() => expect(fake.sent.length + fake.edits.length).toBeGreaterThan(0));

    const pending = channel.permissionResolver.check(
      { callId: 'c1', name: 'write_file', input: {} } as never,
      {} as never,
    );
    await vi.waitFor(() =>
      expect(fake.sent.some((s) => /Permission needed/.test(s.text))).toBe(true),
    );
    await handle.stop('shutdown');
    expect((await pending).mode).toBe('deny');
    expect(fake.ended).toBe(true);
  });

  it('re-pair guidance: a logout in non-pair mode fails the running promise', async () => {
    const fake = new FakeSocket();
    const channel = makeChannel(fake);
    session.setPermissionResolver(channel.permissionResolver);
    const handle = await channel.start({ session });
    fake.open(OWNER);
    const failed = handle.running.then(
      () => 'resolved',
      (err: Error) => err.message,
    );
    fake.close({ output: { statusCode: 401 } });
    expect(await failed).toMatch(/logged this device out|re-link/i);
  });
});
