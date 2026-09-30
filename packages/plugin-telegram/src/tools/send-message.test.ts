import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InputFile } from 'grammy';
import { VaultStore, createStaticKeySource, deriveKey, generateSalt } from '@moxxy/plugin-vault';
import type { ToolContext } from '@moxxy/sdk';
import { TELEGRAM_AUTHORIZED_CHAT_KEY, TELEGRAM_TOKEN_KEY } from '../keys.js';
import { buildTelegramSendMessageTool, type TelegramSendApi } from './send-message.js';

let tmp: string;
let vault: VaultStore;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-tg-send-'));
  vault = new VaultStore({
    filePath: path.join(tmp, 'vault.json'),
    keySource: createStaticKeySource(deriveKey('test', generateSalt())),
  });
  await vault.set(TELEGRAM_TOKEN_KEY, '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  await vault.set(TELEGRAM_AUTHORIZED_CHAT_KEY, '42');
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

type Call =
  | { kind: 'message'; chatId: number; text: string; parseMode?: string }
  | { kind: 'document'; chatId: number; name: string | undefined };

function fakeApi() {
  const calls: Call[] = [];
  const tokens: string[] = [];
  const api: TelegramSendApi = {
    sendMessage: async (chatId, text, opts) => {
      calls.push({ kind: 'message', chatId, text, ...(opts?.parse_mode ? { parseMode: opts.parse_mode } : {}) });
      return undefined;
    },
    sendDocument: async (chatId, file: InputFile) => {
      calls.push({ kind: 'document', chatId, name: file.filename });
      return undefined;
    },
  };
  const tool = buildTelegramSendMessageTool({
    getVault: () => vault,
    createApi: (token) => {
      tokens.push(token);
      return api;
    },
  });
  return { calls, tokens, tool };
}

const ctx = () => ({ cwd: tmp }) as unknown as ToolContext;

describe('telegram_send_message', () => {
  it('sends the text to the paired chat, formatted like the bot replies', async () => {
    const { calls, tokens, tool } = fakeApi();

    const out = await tool.handler({ text: 'Build **done**.' }, ctx());

    expect(tokens).toEqual(['123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ']);
    expect(calls).toEqual([{ kind: 'message', chatId: 42, text: 'Build <b>done</b>.', parseMode: 'HTML' }]);
    expect(out).toMatchObject({ delivered: true, chatId: 42 });
  });

  it('sends the files the owner asked for as documents under the text', async () => {
    await fs.writeFile(path.join(tmp, 'report.pdf'), 'pdf');
    await fs.writeFile(path.join(tmp, 'photo.png'), 'png');
    const { calls, tool } = fakeApi();

    const out = await tool.handler({ text: 'Here you go', files: ['report.pdf', path.join(tmp, 'photo.png')] }, ctx());

    expect(calls).toEqual([
      { kind: 'message', chatId: 42, text: 'Here you go', parseMode: 'HTML' },
      { kind: 'document', chatId: 42, name: 'report.pdf' },
      { kind: 'document', chatId: 42, name: 'photo.png' },
    ]);
    expect(out).toMatchObject({ files: ['report.pdf', 'photo.png'] });
  });

  it('refuses files larger than a bot may upload before sending anything', async () => {
    const big = path.join(tmp, 'film.mp4');
    await fs.writeFile(big, '');
    await fs.truncate(big, 51 * 1024 * 1024);
    const { calls, tool } = fakeApi();

    await expect(tool.handler({ text: 'film', files: [big] }, ctx())).rejects.toThrow(/Telegram accepts at most 50 MB/);
    expect(calls).toEqual([]);
  });

  it('splits a long text into several messages, in order', async () => {
    const { calls, tool } = fakeApi();

    await tool.handler({ text: `${'a'.repeat(4000)}\n${'b'.repeat(4000)}` }, ctx());

    const texts = calls.map((c) => (c.kind === 'message' ? c.text : ''));
    expect(texts.length).toBeGreaterThan(1);
    expect(texts.join('').replace(/\s/g, '')).toBe(`${'a'.repeat(4000)}${'b'.repeat(4000)}`);
  });

  it('keeps an explicit parse mode verbatim', async () => {
    const { calls, tool } = fakeApi();

    await tool.handler({ text: '*raw*', parseMode: 'MarkdownV2' }, ctx());

    expect(calls).toEqual([{ kind: 'message', chatId: 42, text: '*raw*', parseMode: 'MarkdownV2' }]);
  });

  it('says to pair first when no chat is paired', async () => {
    await vault.delete(TELEGRAM_AUTHORIZED_CHAT_KEY);
    const { tool } = fakeApi();

    await expect(tool.handler({ text: 'hi' }, ctx())).rejects.toThrow(/no authorized chat/);
  });
});
