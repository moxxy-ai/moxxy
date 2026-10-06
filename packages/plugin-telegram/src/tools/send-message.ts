import { Api, InputFile } from 'grammy';
import { defineTool, z, type ToolDef } from '@moxxy/sdk';
import { readLocalFiles, resolveSecret } from '@moxxy/channel-kit';
import { TELEGRAM_AUTHORIZED_CHAT_KEY, TELEGRAM_TOKEN_KEY, parseChatId } from '../keys.js';
import { sendMarkdown, type TelegramSender } from '../channel/send-rich.js';

/** The slice of grammy's `Api` this tool uses (the real client satisfies it). */
export interface TelegramSendApi extends TelegramSender {
  sendDocument(chatId: number, document: InputFile): Promise<unknown>;
}

export interface TelegramSendMessageToolDeps {
  readonly getVault: () => { get(name: string): Promise<string | null> };
  /** Build the API client for a token. Defaults to grammy's lightweight `Api`. */
  readonly createApi?: (token: string) => TelegramSendApi;
}

const TOKEN_ENV = 'MOXXY_TELEGRAM_TOKEN';
/** Cap on one push — a couple of Telegram messages once split. */
const MAX_TEXT_CHARS = 8_000;
/** The Bot API accepts uploads up to 50 MB. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 10;

/**
 * `telegram_send_message` — push a message (and files) to the paired chat from
 * ANY session (desktop, goal mode, a scheduled prompt) without the Telegram
 * channel running. A one-off `Api` rather than a full `Bot`: no long-polling.
 */
export function buildTelegramSendMessageTool(deps: TelegramSendMessageToolDeps): ToolDef {
  const createApi = deps.createApi ?? ((token: string) => new Api(token));
  return defineTool({
    name: 'telegram_send_message',
    description:
      'Push a message to the paired Telegram chat. Use it to proactively report progress, a finished ' +
      'task, or a blocker that needs their decision — e.g. from a long goal-mode run or a scheduled ' +
      'prompt — without the Telegram channel running. The text is rendered with the same rich ' +
      'Markdown→Telegram formatting as interactive replies (bold, code, `> [!type]` callouts, ' +
      '`||spoilers||`); pass an explicit `parseMode` to send the raw text under that parse mode ' +
      'instead. Long text is split into several messages. Pass `files` (local paths) to send files ' +
      'the owner asked for as documents — up to 10 files, 50 MB in total. Requires a stored bot ' +
      'token + a paired chat (run `moxxy channels telegram pair` once).',
    inputSchema: z.object({
      text: z.string().trim().min(1).max(MAX_TEXT_CHARS),
      files: z.array(z.string().min(1).max(4096)).max(MAX_FILES).optional(),
      /** Optional override; defaults to the vault-paired chat id. */
      chatId: z.number().int().optional(),
      /** Force a Telegram parse mode and send `text` verbatim under it. */
      parseMode: z.enum(['MarkdownV2', 'Markdown', 'HTML']).optional(),
    }),
    permission: { action: 'prompt' },
    isolation: {
      capabilities: {
        // Attachments are whatever local file the owner asked for; the
        // permission prompt shows the paths before anything is read or sent.
        fs: { read: ['~/.moxxy/vault.*', '~/**', '$cwd/**', '/tmp/**'] },
        net: { mode: 'allowlist', hosts: ['api.telegram.org'] },
        env: [TOKEN_ENV],
        timeMs: 120_000,
      },
    },
    handler: async ({ text, files: filePaths, chatId, parseMode }, ctx) => {
      const vault = deps.getVault();
      const token = await resolveSecret(vault, { envVar: TOKEN_ENV, vaultKey: TELEGRAM_TOKEN_KEY });
      if (!token) {
        throw new Error(
          `no Telegram bot token configured (set ${TOKEN_ENV} or run \`moxxy channels telegram setup\`)`,
        );
      }
      const target = chatId ?? parseChatId(await vault.get(TELEGRAM_AUTHORIZED_CHAT_KEY));
      if (!target) {
        throw new Error('no authorized chat — run `moxxy channels telegram pair` first or pass `chatId` explicitly');
      }
      const files = await readLocalFiles(filePaths ?? [], {
        cwd: ctx.cwd,
        maxTotalBytes: MAX_UPLOAD_BYTES,
        service: 'Telegram',
        limitLabel: '50 MB per upload',
      });

      const api = createApi(token);
      let parts = 1;
      // An explicit mode means the caller owns the markup: send it verbatim.
      if (parseMode) await api.sendMessage(target, text, { parse_mode: parseMode });
      else parts = await sendMarkdown(api, target, text);
      // Files go under the text that introduces them, in order.
      for (const file of files) await api.sendDocument(target, new InputFile(file.data, file.name));
      return {
        delivered: true,
        chatId: target,
        parts,
        length: text.length,
        ...(files.length > 0 ? { files: files.map((f) => f.name) } : {}),
      };
    },
  });
}
