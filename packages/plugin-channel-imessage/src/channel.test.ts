import { describe, expect, it, vi } from 'vitest';
import type { ClientSession as Session } from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';
import { ImessageChannel } from './channel.js';
import type { BlueBubblesClientLike } from './bluebubbles-client.js';
import {
  IMESSAGE_ALLOWED_HANDLES_KEY,
  IMESSAGE_OWNER_HANDLES_KEY,
  IMESSAGE_SERVER_PASSWORD_KEY,
  IMESSAGE_SERVER_URL_KEY,
} from './keys.js';
import { MAX_INBOUND_TEXT_CHARS } from './schema.js';

const OWNER = '+19998887777';
const FRIEND = '+15550001111';
const STRANGER = '+14440002222';
const chatFor = (handle: string): string => `iMessage;-;${handle}`;

function stubVault(seed: Record<string, string> = {}): VaultStore {
  const map = new Map(Object.entries(seed));
  return {
    get: async (k: string) => map.get(k) ?? null,
    set: async (k: string, v: string) => {
      map.set(k, v);
    },
    has: async (k: string) => map.has(k),
    delete: async (k: string) => map.delete(k),
  } as unknown as VaultStore;
}

function makeFakeSession(opts: { hangTurns?: boolean } = {}) {
  const listeners = new Set<(e: unknown) => void>();
  const prompts: string[] = [];
  let release: (() => void) | null = null;
  const session = {
    tools: { list: () => [{ name: 'Read' }, { name: 'Grep' }] },
    transcribers: { tryGetActive: () => null },
    setPermissionResolver: vi.fn(),
    log: {
      subscribe: (fn: (e: unknown) => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    },
    runTurn(prompt: string) {
      prompts.push(prompt);
      const hang = opts.hangTurns;
      return (async function* () {
        if (hang) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
      })();
    },
  };
  return {
    session: session as unknown as Session,
    raw: session,
    prompts,
    releaseTurn: () => release?.(),
  };
}

class FakeClient implements BlueBubblesClientLike {
  sends: Array<{ chatGuid: string; message: string }> = [];
  pinged = false;
  connected = false;
  closed = false;
  private readonly listeners = new Set<(raw: unknown) => void>();
  private n = 0;

  async ping(): Promise<void> {
    this.pinged = true;
  }
  async connect(): Promise<void> {
    this.connected = true;
  }
  onMessage(listener: (raw: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async sendText(chatGuid: string, message: string): Promise<{ guid: string | null; tempGuid: string }> {
    this.sends.push({ chatGuid, message });
    const i = ++this.n;
    return { guid: `guid-${i}`, tempGuid: `temp-${i}` };
  }
  close(): void {
    this.closed = true;
  }
  /** Push one inbound `new-message` payload into the channel. */
  receive(raw: unknown): void {
    for (const listener of this.listeners) listener(raw);
  }
}

function makeChannel(overrides: { vault?: VaultStore; hangTurns?: boolean; allowedTools?: string[] } = {}) {
  const client = new FakeClient();
  const fake = makeFakeSession({ ...(overrides.hangTurns ? { hangTurns: true } : {}) });
  const channel = new ImessageChannel({
    vault:
      overrides.vault ??
      stubVault({
        [IMESSAGE_SERVER_URL_KEY]: 'http://localhost:1234',
        [IMESSAGE_SERVER_PASSWORD_KEY]: 'secret',
        [IMESSAGE_ALLOWED_HANDLES_KEY]: JSON.stringify([FRIEND]),
        [IMESSAGE_OWNER_HANDLES_KEY]: JSON.stringify([OWNER]),
      }),
    ...(overrides.allowedTools ? { allowedTools: overrides.allowedTools } : {}),
    clientFactory: () => client,
  });
  return { channel, client, fake };
}

const inbound = (opts: {
  chatGuid: string;
  text?: string;
  isFromMe?: boolean;
  sender?: string;
  guid?: string;
}): Record<string, unknown> => ({
  guid: opts.guid ?? 'msg-1',
  text: opts.text ?? 'hi',
  isFromMe: opts.isFromMe ?? false,
  ...(opts.sender ? { handle: { address: opts.sender } } : {}),
  chats: [{ guid: opts.chatGuid }],
});

describe('ImessageChannel start()', () => {
  it('pings, connects and swaps in the allow-list resolver on the session', async () => {
    const { channel, client, fake } = makeChannel({ allowedTools: ['Read'] });
    const handle = await channel.start({ session: fake.session });
    expect(client.pinged).toBe(true);
    expect(client.connected).toBe(true);
    expect(fake.raw.setPermissionResolver).toHaveBeenCalledWith(channel.permissionResolver);
    expect(channel.permissionResolver.name).toBe('imessage-allow-list');
    await handle.stop();
  });

  it('throws a friendly error when the server is not configured', async () => {
    const fake = makeFakeSession();
    const channel = new ImessageChannel({ vault: stubVault(), clientFactory: () => new FakeClient() });
    await expect(channel.start({ session: fake.session })).rejects.toThrow(/No BlueBubbles server configured/);
  });
});

describe('inbound gating (every session-reaching path)', () => {
  it('runs a turn for an allow-listed sender and replies to their chat', async () => {
    const { channel, client, fake } = makeChannel();
    const handle = await channel.start({ session: fake.session });
    client.receive(inbound({ chatGuid: chatFor(FRIEND), sender: FRIEND, text: 'hello moxxy' }));
    await vi.waitFor(() => expect(fake.prompts).toEqual(['hello moxxy']));
    await vi.waitFor(() => {
      expect(client.sends.at(-1)).toEqual({ chatGuid: chatFor(FRIEND), message: '(no output)' });
    });
    await handle.stop();
  });

  it('silently drops senders that are not allow-listed', async () => {
    const { channel, client, fake } = makeChannel();
    const handle = await channel.start({ session: fake.session });
    client.receive(inbound({ chatGuid: chatFor(STRANGER), sender: STRANGER, text: 'let me in' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.prompts).toEqual([]);
    expect(client.sends).toEqual([]); // no reply — a reply would leak the bot's existence
    await handle.stop();
  });

  it('drops group messages (v1 is direct-message only)', async () => {
    const { channel, client, fake } = makeChannel();
    const handle = await channel.start({ session: fake.session });
    client.receive(inbound({ chatGuid: 'iMessage;+;chat123', sender: FRIEND, text: 'in a group' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.prompts).toEqual([]);
    await handle.stop();
  });

  it('accepts the owner self-chat and replies into it', async () => {
    const { channel, client, fake } = makeChannel();
    const handle = await channel.start({ session: fake.session });
    client.receive(inbound({ chatGuid: chatFor(OWNER), isFromMe: true, text: 'remind me to stretch' }));
    await vi.waitFor(() => expect(fake.prompts).toEqual(['remind me to stretch']));
    await vi.waitFor(() => {
      expect(client.sends.at(-1)).toEqual({ chatGuid: chatFor(OWNER), message: '(no output)' });
    });
    await handle.stop();
  });

  it("ignores the owner's outbound messages to other people (isFromMe foreign chat)", async () => {
    const { channel, client, fake } = makeChannel();
    const handle = await channel.start({ session: fake.session });
    client.receive(inbound({ chatGuid: chatFor(FRIEND), isFromMe: true, text: 'private chat' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.prompts).toEqual([]);
    await handle.stop();
  });

  it('drops echoes of its own replies (loop protection)', async () => {
    const { channel, client, fake } = makeChannel();
    const handle = await channel.start({ session: fake.session });

    // One self-chat turn: the channel records its send ids (guid-1 / temp-1).
    client.receive(inbound({ chatGuid: chatFor(OWNER), isFromMe: true, text: 'first', guid: 'in-1' }));
    await vi.waitFor(() => expect(client.sends.length).toBe(1));

    // BlueBubbles echoes our reply back as a new-message with our guid — must
    // NOT trigger a turn (it would loop into itself in the self-chat).
    client.receive(inbound({ chatGuid: chatFor(OWNER), isFromMe: true, text: '(no output)', guid: 'guid-1' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.prompts).toEqual(['first']);

    // A genuinely new self-chat message still gets through.
    client.receive(inbound({ chatGuid: chatFor(OWNER), isFromMe: true, text: 'second', guid: 'in-2' }));
    await vi.waitFor(() => expect(fake.prompts).toEqual(['first', 'second']));
    await handle.stop();
  });

  it('drops schema-invalid and oversized payloads without crashing', async () => {
    const { channel, client, fake } = makeChannel();
    const handle = await channel.start({ session: fake.session });
    client.receive(null);
    client.receive('garbage');
    client.receive({ guid: 'x' }); // no chats
    client.receive(inbound({ chatGuid: chatFor(FRIEND), sender: FRIEND, text: 'x'.repeat(MAX_INBOUND_TEXT_CHARS + 1) }));
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.prompts).toEqual([]);
    // Still alive: a valid message afterwards works.
    client.receive(inbound({ chatGuid: chatFor(FRIEND), sender: FRIEND, text: 'still alive?' }));
    await vi.waitFor(() => expect(fake.prompts).toEqual(['still alive?']));
    await handle.stop();
  });

  it('refuses overlapping turns with a busy reply (single-flight)', async () => {
    const { channel, client, fake } = makeChannel({ hangTurns: true });
    const handle = await channel.start({ session: fake.session });
    client.receive(inbound({ chatGuid: chatFor(FRIEND), sender: FRIEND, text: 'long task' }));
    await vi.waitFor(() => expect(fake.prompts).toEqual(['long task']));
    client.receive(inbound({ chatGuid: chatFor(FRIEND), sender: FRIEND, text: 'impatient follow-up', guid: 'm2' }));
    await vi.waitFor(() => {
      expect(client.sends.some((s) => s.message.includes('still working'))).toBe(true);
    });
    expect(fake.prompts).toEqual(['long task']);
    fake.releaseTurn();
    await handle.stop();
  });
});

describe('lifecycle', () => {
  it('stop() closes the client and resolves running', async () => {
    const { channel, client, fake } = makeChannel();
    const handle = await channel.start({ session: fake.session });
    await handle.stop('test');
    expect(client.closed).toBe(true);
    await expect(handle.running).resolves.toBeUndefined();
  });
});
