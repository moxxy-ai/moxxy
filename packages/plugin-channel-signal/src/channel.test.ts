import { describe, expect, it, vi } from 'vitest';
import { assertDefined, type ClientSession as Session } from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';
import { SignalChannel, type SignalRpcLike } from './channel.js';
import { SIGNAL_ACCOUNT_KEY, SIGNAL_ALLOWED_SENDERS_KEY } from './keys.js';
import { MAX_INBOUND_TEXT_CHARS } from './schema.js';

const OWNER = '+19998887777';
const FRIEND = '+15550001111';
const STRANGER = '+14440002222';

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
    emitLog: (e: unknown) => {
      for (const fn of listeners) fn(e);
    },
    releaseTurn: () => release?.(),
  };
}

class FakeRpc implements SignalRpcLike {
  requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  private readonly notif = new Map<string, Set<(p: unknown) => void>>();
  private ts = 1_000;
  async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.requests.push({ method, params });
    if (method === 'send') return { timestamp: this.ts++ };
    return {};
  }
  onNotification(method: string, listener: (params: unknown) => void): () => void {
    let set = this.notif.get(method);
    if (!set) {
      set = new Set();
      this.notif.set(method, set);
    }
    set.add(listener);
    return () => set.delete(listener);
  }
  onClose(): () => void {
    return () => undefined;
  }
  close(): void {}
  /** Push one inbound `receive` notification into the channel. */
  receive(params: unknown): void {
    for (const fn of this.notif.get('receive') ?? []) fn(params);
  }
  sends(): Array<Record<string, unknown>> {
    return this.requests.filter((r) => r.method === 'send').map((r) => r.params);
  }
}

function makeChannel(overrides: {
  vault?: VaultStore;
  hangTurns?: boolean;
  allowedTools?: string[];
} = {}) {
  const rpc = new FakeRpc();
  const sidecarStops: number[] = [];
  const sidecarAccounts: string[] = [];
  const fake = makeFakeSession({ ...(overrides.hangTurns ? { hangTurns: true } : {}) });
  const channel = new SignalChannel({
    vault:
      overrides.vault ??
      stubVault({ [SIGNAL_ALLOWED_SENDERS_KEY]: JSON.stringify([FRIEND]) }),
    account: OWNER,
    ...(overrides.allowedTools ? { allowedTools: overrides.allowedTools } : {}),
    findBinaryFn: () => '/fake/bin/signal-cli',
    listAccountsFn: async () => [OWNER],
    sidecarFactory: ({ account }) => {
      sidecarAccounts.push(account);
      return {
        start: async () => rpc,
        stop: async () => {
          sidecarStops.push(1);
        },
        onExit: () => () => undefined,
      };
    },
  });
  return { channel, rpc, fake, sidecarStops, sidecarAccounts };
}

const dataEnvelope = (from: string, message: string | null, extra: Record<string, unknown> = {}) => ({
  account: OWNER,
  envelope: {
    sourceNumber: from,
    sourceUuid: null,
    timestamp: 1,
    dataMessage: { timestamp: 1, message, ...extra },
  },
});

const noteToSelfEnvelope = (message: string, timestamp = 7_777) => ({
  account: OWNER,
  envelope: {
    sourceNumber: OWNER,
    syncMessage: { sentMessage: { timestamp, message, destinationNumber: OWNER } },
  },
});

describe('SignalChannel start()', () => {
  it('swaps in the real allow-list permission resolver on the session', async () => {
    const { channel, fake } = makeChannel({ allowedTools: ['Read'] });
    const handle = await channel.start({ session: fake.session });
    expect(fake.raw.setPermissionResolver).toHaveBeenCalledWith(channel.permissionResolver);
    expect(channel.permissionResolver.name).toBe('signal-allow-list');
    expect(channel.connected).toBe(true);
    await handle.stop();
  });

  it('throws a pairing hint when unlinked and not in pair/dedicated mode', async () => {
    const { fake } = makeChannel();
    const channel = new SignalChannel({
      vault: stubVault(),
      account: OWNER,
      findBinaryFn: () => '/fake/bin/signal-cli',
      listAccountsFn: async () => [], // nothing linked locally
      sidecarFactory: () => {
        throw new Error('daemon must not boot when unlinked');
      },
    });
    await expect(channel.start({ session: fake.session })).rejects.toThrow(/signal pair/);
  });

  it('throws the install hint when signal-cli is missing', async () => {
    const { fake } = makeChannel();
    const channel = new SignalChannel({
      vault: stubVault(),
      account: OWNER,
      findBinaryFn: () => null,
    });
    await expect(channel.start({ session: fake.session })).rejects.toThrow(/signal-cli not found/);
  });
});

describe('inbound gating (every session-reaching path)', () => {
  it('runs a turn for an allow-listed sender and replies to them', async () => {
    const { channel, rpc, fake } = makeChannel();
    const handle = await channel.start({ session: fake.session });
    rpc.receive(dataEnvelope(FRIEND, 'hello moxxy'));
    await vi.waitFor(() => expect(fake.prompts).toEqual(['hello moxxy']));
    await vi.waitFor(() => {
      const sends = rpc.sends();
      expect(sends.length).toBeGreaterThan(0);
      expect(sends.at(-1)).toEqual({ recipient: [FRIEND], message: '(no output)' });
    });
    await handle.stop();
  });

  it('silently drops senders that are not allow-listed', async () => {
    const { channel, rpc, fake } = makeChannel();
    const handle = await channel.start({ session: fake.session });
    rpc.receive(dataEnvelope(STRANGER, 'let me in'));
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.prompts).toEqual([]);
    expect(rpc.sends()).toEqual([]); // no reply — a reply would leak the bot's existence
    await handle.stop();
  });

  it('drops group messages (v1 is direct-message only)', async () => {
    const { channel, rpc, fake } = makeChannel();
    const handle = await channel.start({ session: fake.session });
    rpc.receive(dataEnvelope(FRIEND, 'in a group', { groupInfo: { groupId: 'g1' } }));
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.prompts).toEqual([]);
    await handle.stop();
  });

  it('drops data messages from our own account (echo path)', async () => {
    const { channel, rpc, fake } = makeChannel();
    const handle = await channel.start({ session: fake.session });
    rpc.receive(dataEnvelope(OWNER, 'talking to myself'));
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.prompts).toEqual([]);
    await handle.stop();
  });

  it('accepts the owner Note-to-Self and replies into it', async () => {
    const { channel, rpc, fake } = makeChannel();
    const handle = await channel.start({ session: fake.session });
    rpc.receive(noteToSelfEnvelope('remind me to stretch'));
    await vi.waitFor(() => expect(fake.prompts).toEqual(['remind me to stretch']));
    await vi.waitFor(() => {
      expect(rpc.sends().at(-1)).toEqual({ noteToSelf: true, message: '(no output)' });
    });
    await handle.stop();
  });

  it("ignores the owner's outbound messages to other people", async () => {
    const { channel, rpc, fake } = makeChannel();
    const handle = await channel.start({ session: fake.session });
    rpc.receive({
      account: OWNER,
      envelope: {
        sourceNumber: OWNER,
        syncMessage: {
          sentMessage: { timestamp: 5, message: 'private chat', destinationNumber: FRIEND },
        },
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.prompts).toEqual([]);
    await handle.stop();
  });

  it('drops sync echoes of its own sends (loop protection)', async () => {
    const { channel, rpc, fake } = makeChannel();
    const handle = await channel.start({ session: fake.session });

    // Run one Note-to-Self turn so the channel records its send timestamp.
    rpc.receive(noteToSelfEnvelope('first', 1));
    await vi.waitFor(() => expect(rpc.sends().length).toBe(1));
    const echoedTimestamp = 1_000; // FakeRpc's first send timestamp

    // The linked-device echo of OUR reply comes back as a sync sentMessage
    // with the timestamp our send returned — must NOT trigger a turn.
    rpc.receive(noteToSelfEnvelope('(no output)', echoedTimestamp));
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.prompts).toEqual(['first']);

    // A genuinely new Note-to-Self message still gets through.
    rpc.receive(noteToSelfEnvelope('second', 2));
    await vi.waitFor(() => expect(fake.prompts).toEqual(['first', 'second']));
    await handle.stop();
  });

  it('drops schema-invalid and oversized payloads without crashing', async () => {
    const { channel, rpc, fake } = makeChannel();
    const handle = await channel.start({ session: fake.session });
    rpc.receive(null);
    rpc.receive('garbage');
    rpc.receive({ envelope: { dataMessage: { message: 42 } } });
    rpc.receive(dataEnvelope(FRIEND, 'x'.repeat(MAX_INBOUND_TEXT_CHARS + 1)));
    await new Promise((r) => setTimeout(r, 20));
    expect(fake.prompts).toEqual([]);
    // Still alive: a valid message afterwards works.
    rpc.receive(dataEnvelope(FRIEND, 'still alive?'));
    await vi.waitFor(() => expect(fake.prompts).toEqual(['still alive?']));
    await handle.stop();
  });

  it('refuses overlapping turns with a busy reply (single-flight)', async () => {
    const { channel, rpc, fake } = makeChannel({ hangTurns: true });
    const handle = await channel.start({ session: fake.session });
    rpc.receive(dataEnvelope(FRIEND, 'long task'));
    await vi.waitFor(() => expect(fake.prompts).toEqual(['long task']));
    rpc.receive(dataEnvelope(FRIEND, 'impatient follow-up'));
    await vi.waitFor(() => {
      expect(rpc.sends().some((s) => String(s['message']).includes('still working'))).toBe(true);
    });
    expect(fake.prompts).toEqual(['long task']);
    fake.releaseTurn();
    await handle.stop();
  });
});

describe('lifecycle', () => {
  it('stop() shuts the sidecar down and resolves running', async () => {
    const { channel, fake, sidecarStops } = makeChannel();
    const handle = await channel.start({ session: fake.session });
    await handle.stop('test');
    expect(sidecarStops).toEqual([1]);
    await expect(handle.running).resolves.toBeUndefined();
  });

  it('pair mode opens a link window, then boots the daemon once linked', async () => {
    const rpc = new FakeRpc();
    const fake = makeFakeSession();
    const vault = stubVault(); // no account stored yet
    let completeLink: ((r: { account: string | null }) => void) | null = null;
    const sidecarAccounts: string[] = [];
    const channel = new SignalChannel({
      vault,
      findBinaryFn: () => '/fake/bin/signal-cli',
      listAccountsFn: async () => [],
      linkFactory: () => ({
        uri: Promise.resolve('sgnl://linkdevice?uuid=abc&pub_key=def'),
        completed: new Promise((resolve) => {
          completeLink = resolve;
        }),
        cancel: () => undefined,
      }),
      sidecarFactory: ({ account }) => {
        sidecarAccounts.push(account);
        return { start: async () => rpc, stop: async () => undefined, onExit: () => () => undefined };
      },
    });
    const linked: string[] = [];
    channel.onLinked((account) => linked.push(account));

    const handle = await channel.start({ session: fake.session, pair: true });
    expect(channel.requestUrl).toBe('sgnl://linkdevice?uuid=abc&pub_key=def');
    expect(channel.connected).toBe(false);

    assertDefined(completeLink, 'linkFactory captured the resolver during start()');
    completeLink({ account: OWNER });
    await vi.waitFor(() => expect(channel.connected).toBe(true));
    expect(channel.requestUrl).toBeNull();
    expect(sidecarAccounts).toEqual([OWNER]);
    expect(linked).toEqual([OWNER]);
    expect(await vault.get(SIGNAL_ACCOUNT_KEY)).toBe(OWNER);

    // The daemon is live: a Note-to-Self message drives a turn.
    rpc.receive(noteToSelfEnvelope('hello after linking'));
    await vi.waitFor(() => expect(fake.prompts).toEqual(['hello after linking']));
    await handle.stop();
  });

  it('dedicated mode (desktop panel) opens the same link window without pair', async () => {
    const fake = makeFakeSession();
    const channel = new SignalChannel({
      vault: stubVault(),
      findBinaryFn: () => '/fake/bin/signal-cli',
      listAccountsFn: async () => [],
      linkFactory: () => ({
        uri: Promise.resolve('sgnl://linkdevice?uuid=xyz'),
        completed: new Promise(() => undefined), // never completes in this test
        cancel: () => undefined,
      }),
    });
    const handle = await channel.start({ session: fake.session, dedicated: true });
    expect(channel.requestUrl).toBe('sgnl://linkdevice?uuid=xyz');
    await handle.stop();
  });
});
