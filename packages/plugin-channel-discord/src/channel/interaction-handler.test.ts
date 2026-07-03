import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultStore, createStaticKeySource, deriveKey, generateSalt } from '@moxxy/plugin-vault';
import type { PendingToolCall, PermissionContext } from '@moxxy/sdk';
import { DISCORD_AUTHORIZED_USER_KEY } from '../keys.js';
import { DiscordApprovalResolver } from '../approval.js';
import { DiscordPermissionResolver } from '../permission.js';
import { AllowListStore } from './allow-list-store.js';
import { PairingHandler } from './pairing-handler.js';
import { handleInteraction, type InteractionLike } from './interaction-handler.js';

const PAIRED = '111111111111';
const STRANGER = '222222222222';
const GUILD = '333333333333';
const CHAN = '444444444444';

let tmp: string;
let vault: VaultStore;
let pairing: PairingHandler;
let allowList: AllowListStore;
let approvalResolver: DiscordApprovalResolver;
let permissionResolver: DiscordPermissionResolver;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-dc-int-'));
  vault = new VaultStore({
    filePath: path.join(tmp, 'vault.json'),
    keySource: createStaticKeySource(deriveKey('test', generateSalt())),
  });
  pairing = new PairingHandler({ vault });
  allowList = new AllowListStore(vault);
  approvalResolver = new DiscordApprovalResolver();
  permissionResolver = new DiscordPermissionResolver();
  await vault.set(DISCORD_AUTHORIZED_USER_KEY, PAIRED);
  await pairing.loadAuthorized();
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

interface FakeInteraction extends InteractionLike {
  readonly replies: Array<{ content: string; ephemeral?: boolean }>;
  readonly updates: unknown[];
}

function buttonInteraction(customId: string, userId = PAIRED): FakeInteraction {
  const replies: Array<{ content: string; ephemeral?: boolean }> = [];
  const updates: unknown[] = [];
  return {
    replies,
    updates,
    isButton: () => true,
    isChatInputCommand: () => false,
    customId,
    user: { id: userId },
    reply: async (p) => {
      replies.push(p);
    },
    update: async (p) => {
      updates.push(p);
    },
    followUp: async (p) => {
      replies.push(p);
    },
  };
}

function slashInteraction(
  commandName: string,
  opts: { userId?: string; guildId?: string | null; channelId?: string | null } = {},
): FakeInteraction {
  const replies: Array<{ content: string; ephemeral?: boolean }> = [];
  return {
    replies,
    updates: [],
    isButton: () => false,
    isChatInputCommand: () => true,
    commandName,
    user: { id: opts.userId ?? PAIRED },
    guildId: opts.guildId ?? null,
    channelId: opts.channelId ?? null,
    reply: async (p) => {
      replies.push(p);
    },
  };
}

function deps() {
  return { pairing, allowList, permissionResolver, approvalResolver };
}

function callbacks() {
  return {
    setAwaitingApprovalText: vi.fn(),
    toggleYolo: vi.fn(() => true),
    performSessionAction: vi.fn(async () => '✓ done'),
  };
}

const state = { session: null, turnController: null };

describe('handleInteraction — authorization gate', () => {
  it('refuses button clicks from an unpaired user (buttons are visible to a whole guild)', async () => {
    // Park a real pending permission so a bypass would be observable.
    permissionResolver.setDecider(async () => undefined);
    const decision = permissionResolver.check(
      { callId: 'c1', name: 'bash', input: {} } as PendingToolCall,
      {} as PermissionContext,
    );
    const interaction = buttonInteraction('perm:c1:allow', STRANGER);
    await handleInteraction(interaction, state, deps(), callbacks());
    expect(interaction.replies[0]?.content).toMatch(/different Discord account/);
    expect(interaction.updates).toEqual([]);
    // The prompt is still pending — the stranger's click resolved nothing.
    permissionResolver.abortAll('test done');
    await expect(decision).resolves.toEqual({ mode: 'deny', reason: 'test done' });
  });

  it('refuses slash commands from an unpaired user', async () => {
    const interaction = slashInteraction('info', { userId: STRANGER });
    await handleInteraction(interaction, state, deps(), callbacks());
    expect(interaction.replies[0]?.content).toMatch(/different Discord account/);
  });
});

describe('handleInteraction — permission buttons', () => {
  it.each([
    ['allow', { mode: 'allow' }],
    ['allow_session', { mode: 'allow_session' }],
    ['deny', { mode: 'deny', reason: 'denied by user' }],
  ] as const)('maps %s clicks to the resolver decision', async (choice, expected) => {
    permissionResolver.setDecider(async () => undefined);
    const decision = permissionResolver.check(
      { callId: 'c1', name: 'bash', input: {} } as PendingToolCall,
      {} as PermissionContext,
    );
    const interaction = buttonInteraction(`perm:c1:${choice}`);
    await handleInteraction(interaction, state, deps(), callbacks());
    await expect(decision).resolves.toEqual(expected);
    // Buttons cleared so the user can't double-click.
    expect(interaction.updates).toEqual([{ components: [] }]);
  });

  it('answers "no pending permission" for a stale click', async () => {
    const interaction = buttonInteraction('perm:ghost:allow');
    await handleInteraction(interaction, state, deps(), callbacks());
    expect(interaction.replies[0]?.content).toMatch(/no pending permission/);
  });
});

describe('handleInteraction — approval buttons', () => {
  it('resolves a pending approval by option id', async () => {
    approvalResolver.setDecider(async () => undefined);
    const decision = approvalResolver.confirm({
      title: 't',
      body: 'b',
      options: [
        { id: 'approve', label: 'Approve' },
        { id: 'cancel', label: 'Cancel' },
      ],
      defaultOptionId: 'approve',
    } as never);
    const interaction = buttonInteraction('appr:appr_1:approve');
    await handleInteraction(interaction, state, deps(), callbacks());
    await expect(decision).resolves.toEqual({ optionId: 'approve' });
  });

  it('latches awaiting-text for options that request follow-up text', async () => {
    approvalResolver.setDecider(async () => undefined);
    void approvalResolver.confirm({
      title: 't',
      body: 'b',
      options: [{ id: 'redraft', label: 'Redraft', requestsText: true, textPrompt: 'Say more' }],
      defaultOptionId: 'redraft',
    } as never);
    const cb = callbacks();
    const interaction = buttonInteraction('appr:appr_1:redraft');
    await handleInteraction(interaction, state, deps(), cb);
    expect(cb.setAwaitingApprovalText).toHaveBeenCalledWith({
      approvalId: 'appr_1',
      optionId: 'redraft',
    });
    expect(interaction.replies[0]?.content).toMatch(/Say more/);
    approvalResolver.abortAll('test done');
  });
});

describe('handleInteraction — slash commands', () => {
  it('/allow works in a guild channel that is NOT yet allow-listed', async () => {
    const interaction = slashInteraction('allow', { guildId: GUILD, channelId: CHAN });
    await handleInteraction(interaction, state, deps(), callbacks());
    expect(allowList.has(CHAN)).toBe(true);
    expect(interaction.replies[0]?.content).toMatch(/✓/);
  });

  it('other commands in a non-allow-listed guild channel get the /allow hint', async () => {
    const interaction = slashInteraction('info', { guildId: GUILD, channelId: CHAN });
    await handleInteraction(interaction, state, deps(), callbacks());
    expect(interaction.replies[0]?.content).toMatch(/\/allow/);
  });

  it('/cancel aborts the in-flight turn', async () => {
    const controller = new AbortController();
    const interaction = slashInteraction('cancel');
    await handleInteraction(interaction, { session: null, turnController: controller }, deps(), callbacks());
    expect(controller.signal.aborted).toBe(true);
    expect(interaction.replies[0]?.content).toMatch(/cancelling/);
  });
});
