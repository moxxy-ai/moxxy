import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultStore, createStaticKeySource, deriveKey, generateSalt } from '@moxxy/plugin-vault';
import type { ClientSession as Session } from '@moxxy/sdk';
import { DISCORD_AUTHORIZED_USER_KEY } from '../keys.js';
import type { InboundMessage } from '../schema.js';
import { extractInboundMessage, MAX_CONTENT_CHARS } from '../schema.js';
import { DiscordApprovalResolver } from '../approval.js';
import { DiscordPermissionResolver } from '../permission.js';
import { AllowListStore } from './allow-list-store.js';
import { PairingHandler } from './pairing-handler.js';
import {
  handleInboundMessage,
  type InboundContext,
  type MessageHandlerCallbacks,
  type MessageHandlerState,
} from './message-handler.js';

const PAIRED = '111111111111';
const STRANGER = '222222222222';
const GUILD = '333333333333';
const CHAN = '444444444444';
const DM_CHAN = '555555555555';

let tmp: string;
let vault: VaultStore;
let pairing: PairingHandler;
let allowList: AllowListStore;
let approvalResolver: DiscordApprovalResolver;
let permissionResolver: DiscordPermissionResolver;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-dc-msg-'));
  vault = new VaultStore({
    filePath: path.join(tmp, 'vault.json'),
    keySource: createStaticKeySource(deriveKey('test', generateSalt())),
  });
  pairing = new PairingHandler({ vault });
  allowList = new AllowListStore(vault);
  approvalResolver = new DiscordApprovalResolver();
  permissionResolver = new DiscordPermissionResolver();
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function pairAs(userId: string): Promise<void> {
  await vault.set(DISCORD_AUTHORIZED_USER_KEY, userId);
  await pairing.loadAuthorized();
}

function msg(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: '999999999999',
    content: 'hello',
    channelId: DM_CHAN,
    guildId: null,
    authorId: PAIRED,
    authorIsBot: false,
    attachments: [],
    ...overrides,
  };
}

interface Ctxed {
  ctx: InboundContext;
  replies: string[];
}

function makeCtx(m: InboundMessage): Ctxed {
  const replies: string[] = [];
  return {
    replies,
    ctx: {
      msg: m,
      channel: { send: async () => ({ edit: async () => undefined }) },
      reply: async (text: string) => {
        replies.push(text);
      },
    },
  };
}

function makeState(overrides: Partial<MessageHandlerState> = {}): MessageHandlerState {
  return {
    session: null,
    busy: false,
    turnController: null,
    awaitingApprovalText: null,
    handle: null,
    botUserId: null,
    ...overrides,
  };
}

function makeCallbacks(overrides: Partial<MessageHandlerCallbacks> = {}): MessageHandlerCallbacks & {
  runUserTurn: ReturnType<typeof vi.fn>;
  runVoiceMessage: ReturnType<typeof vi.fn>;
} {
  const runUserTurn = vi.fn(async () => undefined);
  const runVoiceMessage = vi.fn(async () => false);
  return {
    setAwaitingApprovalText: () => undefined,
    toggleYolo: () => false,
    setYolo: () => undefined,
    runUserTurn,
    runVoiceMessage,
    ...overrides,
  } as never;
}

function deps() {
  return { pairing, allowList, approvalResolver, permissionResolver };
}

describe('handleInboundMessage — gating (every session-reaching path)', () => {
  it('drops an unpaired DM with pairing guidance (no window armed)', async () => {
    const { ctx, replies } = makeCtx(msg({ authorId: STRANGER }));
    const cb = makeCallbacks();
    await handleInboundMessage(ctx, makeState(), deps(), cb);
    expect(cb.runUserTurn).not.toHaveBeenCalled();
    expect(replies.join(' ')).toMatch(/pairing window/i);
  });

  it('issues a pairing code to an unpaired DM when the window is armed', async () => {
    pairing.arm();
    const { ctx, replies } = makeCtx(msg({ authorId: STRANGER }));
    const cb = makeCallbacks();
    await handleInboundMessage(ctx, makeState(), deps(), cb);
    expect(cb.runUserTurn).not.toHaveBeenCalled();
    expect(replies[0]).toMatch(/pairing code/i);
  });

  it('silently drops unpaired GUILD messages (no server spam)', async () => {
    pairing.arm();
    const { ctx, replies } = makeCtx(msg({ authorId: STRANGER, guildId: GUILD, channelId: CHAN }));
    const cb = makeCallbacks();
    await handleInboundMessage(ctx, makeState(), deps(), cb);
    expect(cb.runUserTurn).not.toHaveBeenCalled();
    expect(replies).toEqual([]);
  });

  it('drops a foreign user in a guild even when the channel is allow-listed', async () => {
    await pairAs(PAIRED);
    await allowList.add(CHAN);
    const { ctx, replies } = makeCtx(msg({ authorId: STRANGER, guildId: GUILD, channelId: CHAN }));
    const cb = makeCallbacks();
    await handleInboundMessage(ctx, makeState(), deps(), cb);
    expect(cb.runUserTurn).not.toHaveBeenCalled();
    expect(replies).toEqual([]);
  });

  it('blocks the paired user in a non-allow-listed guild channel with a hint', async () => {
    await pairAs(PAIRED);
    const { ctx, replies } = makeCtx(msg({ guildId: GUILD, channelId: CHAN }));
    const cb = makeCallbacks();
    await handleInboundMessage(ctx, makeState(), deps(), cb);
    expect(cb.runUserTurn).not.toHaveBeenCalled();
    expect(replies[0]).toMatch(/\/allow/);
  });

  it('/allow from the paired user opts a guild channel in; messages then flow', async () => {
    await pairAs(PAIRED);
    const first = makeCtx(msg({ guildId: GUILD, channelId: CHAN, content: '/allow' }));
    const cb = makeCallbacks();
    await handleInboundMessage(first.ctx, makeState(), deps(), cb);
    expect(first.replies[0]).toMatch(/✓/);
    expect(allowList.has(CHAN)).toBe(true);

    const second = makeCtx(msg({ guildId: GUILD, channelId: CHAN, content: 'do the thing' }));
    await handleInboundMessage(second.ctx, makeState(), deps(), cb);
    expect(cb.runUserTurn).toHaveBeenCalledWith(second.ctx, 'do the thing');
  });

  it('/deny removes a guild channel from the allow-list', async () => {
    await pairAs(PAIRED);
    await allowList.add(CHAN);
    const { ctx, replies } = makeCtx(msg({ guildId: GUILD, channelId: CHAN, content: '/deny' }));
    await handleInboundMessage(ctx, makeState(), deps(), makeCallbacks());
    expect(replies[0]).toMatch(/removed/);
    expect(allowList.has(CHAN)).toBe(false);
  });

  it('never reacts to bot-authored messages (paired or not)', async () => {
    await pairAs(PAIRED);
    const { ctx, replies } = makeCtx(msg({ authorIsBot: true }));
    const cb = makeCallbacks();
    await handleInboundMessage(ctx, makeState(), deps(), cb);
    expect(cb.runUserTurn).not.toHaveBeenCalled();
    expect(replies).toEqual([]);
  });

  it('drops oversized content at the validation boundary (extractInboundMessage)', () => {
    const raw = {
      id: '999999999999',
      content: 'x'.repeat(MAX_CONTENT_CHARS + 1),
      channelId: DM_CHAN,
      guildId: null,
      author: { id: PAIRED, bot: false },
      attachments: null,
    };
    expect(extractInboundMessage(raw)).toBeNull();
    // Under the cap it validates.
    expect(extractInboundMessage({ ...raw, content: 'ok' })).not.toBeNull();
  });
});

describe('handleInboundMessage — dispatch', () => {
  it('runs a user turn for a paired DM', async () => {
    await pairAs(PAIRED);
    const { ctx } = makeCtx(msg({ content: 'what time is it' }));
    const cb = makeCallbacks();
    await handleInboundMessage(ctx, makeState(), deps(), cb);
    expect(cb.runUserTurn).toHaveBeenCalledWith(ctx, 'what time is it');
  });

  it('refuses new prompts while busy', async () => {
    await pairAs(PAIRED);
    const { ctx, replies } = makeCtx(msg());
    const cb = makeCallbacks();
    await handleInboundMessage(ctx, makeState({ busy: true }), deps(), cb);
    expect(cb.runUserTurn).not.toHaveBeenCalled();
    expect(replies[0]).toMatch(/still working/);
  });

  it('/cancel aborts the in-flight turn even while busy', async () => {
    await pairAs(PAIRED);
    const controller = new AbortController();
    const { ctx, replies } = makeCtx(msg({ content: '/cancel' }));
    await handleInboundMessage(
      ctx,
      makeState({ busy: true, turnController: controller }),
      deps(),
      makeCallbacks(),
    );
    expect(controller.signal.aborted).toBe(true);
    expect(replies[0]).toMatch(/cancelling/);
  });

  it('captures awaiting-approval text before the busy guard', async () => {
    await pairAs(PAIRED);
    // Wire a decider so confirm() parks as pending (id 'appr_1').
    approvalResolver.setDecider(async () => undefined);
    const pendingDecision = approvalResolver.confirm({
      title: 't',
      body: 'b',
      options: [{ id: 'redraft', label: 'Redraft', requestsText: true }],
      defaultOptionId: 'redraft',
    } as never);

    const setAwaiting = vi.fn();
    const { ctx, replies } = makeCtx(msg({ content: 'my feedback here' }));
    await handleInboundMessage(
      ctx,
      makeState({ busy: true, awaitingApprovalText: { approvalId: 'appr_1', optionId: 'redraft' } }),
      deps(),
      makeCallbacks({ setAwaitingApprovalText: setAwaiting }),
    );
    expect(setAwaiting).toHaveBeenCalledWith(null);
    expect(replies[0]).toMatch(/✓ submitted/);
    await expect(pendingDecision).resolves.toEqual({ optionId: 'redraft', text: 'my feedback here' });
  });

  it('routes registry slash commands through session.commands', async () => {
    await pairAs(PAIRED);
    const handler = vi.fn(async () => ({ kind: 'text', text: 'info output' }));
    const session = {
      id: 'sess',
      commands: { get: (name: string) => (name === 'info' ? { handler } : undefined) },
    } as unknown as Session;
    const { ctx, replies } = makeCtx(msg({ content: '/info' }));
    await handleInboundMessage(ctx, makeState({ session }), deps(), makeCallbacks());
    expect(handler).toHaveBeenCalled();
    expect(replies[0]).toBe('info output');
  });

  it('dispatches audio attachments to the voice path instead of a text turn', async () => {
    await pairAs(PAIRED);
    const { ctx } = makeCtx(
      msg({
        content: '',
        attachments: [
          { id: '888888888888', url: 'https://cdn.example/x.ogg', contentType: 'audio/ogg', size: 100, name: 'v.ogg' },
        ],
      }),
    );
    const cb = makeCallbacks({ runVoiceMessage: vi.fn(async () => true) });
    await handleInboundMessage(ctx, makeState(), deps(), cb);
    expect(cb.runVoiceMessage).toHaveBeenCalledWith(ctx);
    expect(cb.runUserTurn).not.toHaveBeenCalled();
  });
});
