import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultStore, createStaticKeySource, deriveKey, generateSalt } from '@moxxy/plugin-vault';
import { Session, autoAllowResolver, silentLogger } from '@moxxy/core';
import { defineTool, z, type PendingToolCall, type PermissionContext, type QuestionOutcome } from '@moxxy/sdk';
import { ChatQuestions, type QuestionUpdate } from '@moxxy/channel-kit';
import { DISCORD_AUTHORIZED_USER_KEY } from '../keys.js';
import { DiscordApprovalResolver } from '../approval.js';
import { DiscordPermissionResolver } from '../permission.js';
import { AllowListStore } from './allow-list-store.js';
import { PairingHandler } from './pairing-handler.js';
import { handleInteraction, type InteractionLike } from './interaction-handler.js';
import { removeDir } from '@moxxy/vitest-preset/fs';

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
  await removeDir(tmp);
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
    deferUpdate: async () => {
      updates.push('deferred');
    },
  };
}

function askingSession(allowOther: boolean) {
  const session = new Session({ cwd: '/tmp', silent: true });
  session.tools.register(
    defineTool({
      name: 'asks',
      description: 'Asks the person.',
      inputSchema: z.object({}),
      handler: async (_input, ctx) =>
        ctx.ask
          ? ctx.ask([{ id: 'q1', question: 'Which colour?', options: [{ id: 'red', label: 'Red' }], multiSelect: false, allowOther }])
          : 'no ask',
    }),
  );
  const questions = new ChatQuestions(() => session);
  const updates: QuestionUpdate[] = [];
  questions.attach((update) => updates.push(update));
  const asked = session.tools.execute('asks', {}, new AbortController().signal, { turnId: 't1' }) as Promise<QuestionOutcome>;
  return { session, questions, updates, asked };
}

function slashInteraction(
  commandName: string,
  opts: {
    userId?: string;
    guildId?: string | null;
    channelId?: string | null;
    stringOptions?: Record<string, string>;
  } = {},
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
    options: { getString: (name: string) => opts.stringOptions?.[name] ?? null },
    reply: async (p) => {
      replies.push(p);
    },
  };
}

function autocompleteInteraction(
  commandName: string,
  focused: string,
  opts: { userId?: string; guildId?: string | null; channelId?: string | null } = {},
) {
  const responses: Array<ReadonlyArray<{ name: string; value: string }>> = [];
  const interaction: InteractionLike = {
    isButton: () => false,
    isChatInputCommand: () => false,
    isAutocomplete: () => true,
    commandName,
    user: { id: opts.userId ?? PAIRED },
    guildId: opts.guildId ?? null,
    channelId: opts.channelId ?? null,
    options: { getString: () => null, getFocused: () => focused },
    reply: async () => undefined,
    respond: async (choices) => {
      responses.push(choices);
    },
  };
  return { interaction, responses };
}

function deps(questions = new ChatQuestions(() => null)) {
  return { pairing, allowList, permissionResolver, approvalResolver, questions };
}

function callbacks() {
  return {
    setAwaitingApprovalText: vi.fn(),
    toggleYolo: vi.fn(async () => true),
    voice: vi.fn(async () => ''),
    model: vi.fn(async () => ''),
    modelSuggestions: vi.fn(async () => [] as Array<{ name: string; value: string }>),
    call: vi.fn(async () => '📞 calling'),
    hangup: vi.fn(() => '📴 ended'),
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

describe('handleInteraction — command arguments', () => {
  it('passes the /model "name" option through to the model command', async () => {
    const session = new Session({ cwd: tmp, logger: silentLogger, permissionResolver: autoAllowResolver });
    const model = vi.fn(async (arg: string) => `model:${arg}`);
    const interaction = slashInteraction('model', { stringOptions: { name: 'beta::b-fast' } });

    await handleInteraction(interaction, { session, turnController: null }, deps(), { ...callbacks(), model });

    expect(model).toHaveBeenCalledWith('beta::b-fast');
    expect(interaction.replies[0]?.content).toBe('model:beta::b-fast');
  });
});

describe('handleInteraction — /auto-approve', () => {
  it('turns auto-approve on and says so', async () => {
    const session = new Session({ cwd: tmp, logger: silentLogger, permissionResolver: autoAllowResolver });
    const toggleYolo = vi.fn(async () => true);
    const interaction = slashInteraction('auto-approve');

    await handleInteraction(interaction, { session, turnController: null }, deps(), { ...callbacks(), toggleYolo });

    expect(toggleYolo).toHaveBeenCalledOnce();
    expect(interaction.replies[0]?.content).toMatch(/auto-approve ON/);
  });

  it('turns it back off', async () => {
    const session = new Session({ cwd: tmp, logger: silentLogger, permissionResolver: autoAllowResolver });
    const interaction = slashInteraction('auto-approve');

    await handleInteraction(interaction, { session, turnController: null }, deps(), {
      ...callbacks(),
      toggleYolo: async () => false,
    });

    expect(interaction.replies[0]?.content).toMatch(/auto-approve OFF/);
  });
});

describe('handleInteraction — /model suggestions', () => {
  it('answers what is being typed in the "name" option with matching models', async () => {
    const session = new Session({ cwd: tmp, logger: silentLogger, permissionResolver: autoAllowResolver });
    const modelSuggestions = vi.fn(async (q: string) => [{ name: `${q}-model`, value: `p::${q}-model` }]);
    const { interaction, responses } = autocompleteInteraction('model', 'gpt');

    await handleInteraction(interaction, { session, turnController: null }, deps(), {
      ...callbacks(),
      modelSuggestions,
    });

    expect(modelSuggestions).toHaveBeenCalledWith('gpt');
    expect(responses).toEqual([[{ name: 'gpt-model', value: 'p::gpt-model' }]]);
  });

  it('suggests nothing to an unpaired user', async () => {
    const session = new Session({ cwd: tmp, logger: silentLogger, permissionResolver: autoAllowResolver });
    const modelSuggestions = vi.fn(async () => [{ name: 'x', value: 'x' }]);
    const { interaction, responses } = autocompleteInteraction('model', '', { userId: STRANGER });

    await handleInteraction(interaction, { session, turnController: null }, deps(), {
      ...callbacks(),
      modelSuggestions,
    });

    expect(modelSuggestions).not.toHaveBeenCalled();
    expect(responses).toEqual([[]]);
  });

  it('suggests nothing in a guild channel that is not allow-listed', async () => {
    const session = new Session({ cwd: tmp, logger: silentLogger, permissionResolver: autoAllowResolver });
    const modelSuggestions = vi.fn(async () => [{ name: 'x', value: 'x' }]);
    const { interaction, responses } = autocompleteInteraction('model', '', { guildId: GUILD, channelId: CHAN });

    await handleInteraction(interaction, { session, turnController: null }, deps(), {
      ...callbacks(),
      modelSuggestions,
    });

    expect(modelSuggestions).not.toHaveBeenCalled();
    expect(responses).toEqual([[]]);
  });
});

describe('handleInteraction — voice calls', () => {
  it('/call starts a call and says where', async () => {
    const session = new Session({ cwd: tmp, logger: silentLogger, permissionResolver: autoAllowResolver });
    const call = vi.fn(async () => '📞 On a call in <#lobby>');
    const interaction = slashInteraction('call');

    await handleInteraction(interaction, { session, turnController: null }, deps(), { ...callbacks(), call });

    expect(call).toHaveBeenCalledOnce();
    expect(interaction.replies[0]?.content).toBe('📞 On a call in <#lobby>');
  });

  it('/hangup ends it', async () => {
    const session = new Session({ cwd: tmp, logger: silentLogger, permissionResolver: autoAllowResolver });
    const hangup = vi.fn(() => '📴 Call ended.');
    const interaction = slashInteraction('hangup');

    await handleInteraction(interaction, { session, turnController: null }, deps(), { ...callbacks(), hangup });

    expect(hangup).toHaveBeenCalledOnce();
    expect(interaction.replies[0]?.content).toBe('📴 Call ended.');
  });
});

describe('handleInteraction — a Question button', () => {
  it('answers the Question with the clicked answer and acks the click without a message', async () => {
    const { questions, updates, asked } = askingSession(false);
    await new Promise((resolve) => setImmediate(resolve));
    const shown = updates[0];
    if (!shown || shown.kind !== 'show') throw new Error('expected the card');
    const red = shown.card.rows.flat()[0];
    if (!red) throw new Error('expected the Red button');
    const interaction = buttonInteraction(red.data);

    await handleInteraction(interaction, state, deps(questions), callbacks());

    await expect(asked).resolves.toEqual({ kind: 'answered', answers: { q1: { selected: ['red'] } } });
    expect(interaction.updates).toEqual(['deferred']);
    expect(interaction.replies).toEqual([]);
  });

  it('refuses a Question button from someone the bot is not paired with', async () => {
    const { questions, updates } = askingSession(false);
    await new Promise((resolve) => setImmediate(resolve));
    const shown = updates[0];
    if (!shown || shown.kind !== 'show') throw new Error('expected the card');
    const red = shown.card.rows.flat()[0];
    if (!red) throw new Error('expected the Red button');

    await handleInteraction(buttonInteraction(red.data, STRANGER), state, deps(questions), callbacks());

    expect(updates.map((u) => u.kind)).toEqual(['show']);
  });
});
