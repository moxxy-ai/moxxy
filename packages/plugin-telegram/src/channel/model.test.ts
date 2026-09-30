import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Context } from 'grammy';
import { Session, autoAllowResolver, silentLogger } from '@moxxy/core';
import { FakeProvider } from '@moxxy/testing';
import { defineProvider, definePlugin } from '@moxxy/sdk';
import { VaultStore, createStaticKeySource, deriveKey, generateSalt } from '@moxxy/plugin-vault';

// A model picked for the bot must never become the desktop's/TUI's model.
const setCategoryDefault = vi.fn(async () => undefined);
const setProviderModel = vi.fn(async () => undefined);
vi.mock('@moxxy/config', () => ({
  setCategoryDefault: (...a: unknown[]) => setCategoryDefault(...a),
  setProviderModel: (...a: unknown[]) => setProviderModel(...a),
}));

import { TELEGRAM_MODEL_KEY } from '../keys.js';
import { telegramModel } from './model.js';
import { runSlash } from './slash-handler.js';
import { handleCallback } from './callback-handler.js';

let tmp: string;
let vault: VaultStore;
let session: Session;

function providerDef(name: string, modelIds: ReadonlyArray<string>) {
  const models = modelIds.map((id) => ({
    id,
    contextWindow: 100_000,
    maxOutputTokens: 4_000,
    supportsTools: true,
    supportsStreaming: true,
  }));
  const instance = new FakeProvider({ name, models });
  return defineProvider({ name, models, createClient: () => instance });
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-tg-model-'));
  vault = new VaultStore({
    filePath: path.join(tmp, 'vault.json'),
    keySource: createStaticKeySource(deriveKey('test', generateSalt())),
  });
  session = new Session({ cwd: tmp, logger: silentLogger, permissionResolver: autoAllowResolver });
  session.pluginHost.registerStatic(
    definePlugin({
      name: 'telegram-model-test',
      providers: [providerDef('alpha', ['a-small', 'a-large']), providerDef('beta', ['b-fast'])],
    }),
  );
  session.providers.setActive('alpha');
  session.readyProviders = new Set(['alpha']);
  session.credentialResolver = async () => ({});
  setCategoryDefault.mockClear();
  setProviderModel.mockClear();
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

interface Keyboard {
  inline_keyboard: Array<Array<{ text: string; callback_data: string; style?: string }>>;
}

function chat() {
  const replies: Array<{ text: string; keyboard?: Keyboard }> = [];
  const ctx = {
    reply: async (text: string, extra?: { reply_markup?: Keyboard }) => {
      replies.push({ text, ...(extra?.reply_markup ? { keyboard: extra.reply_markup } : {}) });
    },
  } as unknown as Context;
  return { ctx, replies };
}

function slash(text: string) {
  const { ctx, replies } = chat();
  const model = telegramModel({ session, vault });
  return runSlash(
    ctx,
    text,
    { session, voiceReplies: false },
    {
      toggleYolo: async () => false,
      setVoiceReplies: async () => undefined,
      model,
      performSessionAction: async () => undefined,
    },
  ).then(() => replies);
}

function tap(data: string) {
  const edits: Array<{ text: string; keyboard?: Keyboard }> = [];
  const toasts: string[] = [];
  const target = { id: 42 };
  const ctx = {
    chat: target,
    callbackQuery: { data, message: { chat: target } },
    answerCallbackQuery: async (arg?: { text?: string }) => void toasts.push(arg?.text ?? ''),
    editMessageText: async (text: string, extra?: { reply_markup?: Keyboard }) =>
      void edits.push({ text, ...(extra?.reply_markup ? { keyboard: extra.reply_markup } : {}) }),
    editMessageReplyMarkup: async () => true,
  } as unknown as Context;
  const model = telegramModel({ session, vault });
  return handleCallback(
    ctx,
    {
      bot: null,
      session,
      chatId: 42,
      permissionResolver: { resolvePending: vi.fn() } as never,
      approvalResolver: { getPending: () => undefined, resolvePending: vi.fn() } as never,
      pairing: { isAuthorized: () => true },
    },
    { setAwaitingApprovalText: () => undefined, model },
  ).then(() => ({ edits, toasts }));
}

const buttons = (keyboard?: Keyboard) => (keyboard?.inline_keyboard ?? []).flat();

describe('/model on Telegram (the bot keeps a model of its own, like the Discord bot)', () => {
  it('without an argument offers the providers first, marking the one the bot runs', async () => {
    await vault.set(TELEGRAM_MODEL_KEY, 'alpha::a-large');

    const [picker] = await slash('/model');

    expect(picker?.text).toContain('alpha::a-large');
    expect(buttons(picker?.keyboard).map((b) => [b.text, b.callback_data, b.style])).toEqual([
      ['Default model', 'model:default', undefined],
      ['✓ alpha · 2 models', 'mprov:alpha', 'success'],
      ['beta · not connected', 'mprov:beta', undefined],
    ]);
  });

  it('marks the default model when the bot has none of its own', async () => {
    const [picker] = await slash('/model');
    expect(buttons(picker?.keyboard)[0]).toMatchObject({ text: '✓ Default model', style: 'success' });
  });

  it("tapping a provider shows its models, the bot's one marked, with a way back", async () => {
    await vault.set(TELEGRAM_MODEL_KEY, 'alpha::a-large');

    const { edits } = await tap('mprov:alpha');

    expect(edits[0]?.text).toContain('alpha');
    expect(buttons(edits[0]?.keyboard).map((b) => [b.text, b.callback_data, b.style])).toEqual([
      ['a-small', 'model:alpha::a-small', undefined],
      ['✓ a-large', 'model:alpha::a-large', 'success'],
      ['‹ Providers', 'mprov:', undefined],
    ]);
  });

  it('‹ Providers goes back to the providers', async () => {
    const { edits } = await tap('mprov:');
    expect(buttons(edits[0]?.keyboard).map((b) => b.callback_data)).toEqual([
      'model:default',
      'mprov:alpha',
      'mprov:beta',
    ]);
  });

  it('with an argument switches this bot to the model it names', async () => {
    const [reply] = await slash('/model a-large');

    expect(reply?.text).toMatch(/✓ switched to alpha::a-large/);
    expect(await vault.get(TELEGRAM_MODEL_KEY)).toBe('alpha::a-large');
  });

  it('a tapped model is saved for this bot only — the global default stays', async () => {
    const { edits } = await tap('model:alpha::a-large');

    expect(edits.map((e) => e.text)).toEqual(['✓ switched to alpha::a-large for this bot.']);
    expect(await vault.get(TELEGRAM_MODEL_KEY)).toBe('alpha::a-large');
    expect(setCategoryDefault).not.toHaveBeenCalled();
    expect(setProviderModel).not.toHaveBeenCalled();
  });

  it('tapping "default" goes back to the default model', async () => {
    await vault.set(TELEGRAM_MODEL_KEY, 'alpha::a-large');

    const { edits } = await tap('model:default');

    expect(edits.map((e) => e.text)).toEqual(['✓ back to the default model.']);
    expect(await vault.get(TELEGRAM_MODEL_KEY)).toBeNull();
  });

  it('a provider that is not connected is refused and nothing is saved', async () => {
    const { edits } = await tap('model:beta::b-fast');

    expect(edits[0]?.text).toMatch(/isn't connected/);
    expect(await vault.get(TELEGRAM_MODEL_KEY)).toBeNull();
  });
});

describe('the model for the next turn', () => {
  it('is the one saved for the bot — also when it was changed from the desktop panel', async () => {
    await vault.set(TELEGRAM_MODEL_KEY, 'alpha::a-large');
    expect(await telegramModel({ session, vault }).resolve()).toEqual({ model: 'a-large' });
  });
});
