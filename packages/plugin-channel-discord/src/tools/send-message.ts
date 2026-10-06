import { REST, Routes, type RawFile } from 'discord.js';
import { defineTool, z, type ToolDef } from '@moxxy/sdk';
import { readLocalFiles } from '@moxxy/channel-kit';
import {
  DISCORD_AUTHORIZED_USER_KEY,
  DISCORD_TOKEN_ENV,
  parseAuthorizedUser,
  resolveBotToken,
} from '../keys.js';
import { splitForDiscord } from '../render.js';

/** The slice of discord.js `REST` this tool uses (the real client satisfies it). */
export interface DiscordRestPoster {
  post(route: `/${string}`, options?: { body?: unknown; files?: RawFile[] }): Promise<unknown>;
}

export interface DiscordSendMessageToolDeps {
  readonly getVault: () => { get(name: string): Promise<string | null> };
  /** Build the REST client for a token. Defaults to a one-off discord.js `REST`. */
  readonly createRest?: (token: string) => DiscordRestPoster;
}

/** Cap on one push — a handful of Discord messages once split. */
const MAX_TEXT_CHARS = 8_000;

/** Discord's per-message upload cap for bots (all attachments together). */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Discord allows at most 10 attachments per message. */
const MAX_FILES = 10;

const dmChannelSchema = z.object({ id: z.string().min(1) });

/**
 * One-off client: the sweeper timers only matter for a long-lived client, and
 * a fresh instance per push would otherwise leave two of them pending for hours.
 */
function createOneOffRest(token: string): DiscordRestPoster {
  return new REST({ version: '10', hashSweepInterval: 0, handlerSweepInterval: 0 }).setToken(token);
}

/**
 * `discord_send_message` — push a DM to the paired owner from ANY session
 * (desktop, goal mode, a scheduled prompt) without the Discord channel running.
 * The recipient is always the vault-paired owner: there is deliberately no
 * recipient override, so a prompt-injected turn cannot DM arbitrary users.
 */
export function buildDiscordSendMessageTool(deps: DiscordSendMessageToolDeps): ToolDef {
  const createRest = deps.createRest ?? createOneOffRest;
  return defineTool({
    name: 'discord_send_message',
    description:
      'Push a direct message to the paired owner on Discord. Use it to proactively report ' +
      'progress, a finished task, or a blocker that needs their decision — e.g. from a long ' +
      'goal-mode run or a scheduled prompt — without the Discord channel running. Discord ' +
      'markdown is rendered as-is; long text is split into several messages. Pass `files` ' +
      '(local paths) to send files the owner asked for as attachments — up to 10 files, ' +
      '10 MB in total. Requires a stored bot token + a paired account ' +
      '(`moxxy channels discord setup`).',
    inputSchema: z.object({
      text: z.string().trim().min(1).max(MAX_TEXT_CHARS),
      files: z.array(z.string().min(1).max(4096)).max(MAX_FILES).optional(),
    }),
    permission: { action: 'prompt' },
    isolation: {
      capabilities: {
        // Attachments are whatever local file the owner asked for; the
        // permission prompt shows the paths before anything is read or sent.
        fs: { read: ['~/.moxxy/vault.*', '~/**', '$cwd/**', '/tmp/**'] },
        net: { mode: 'allowlist', hosts: ['discord.com'] },
        env: [DISCORD_TOKEN_ENV],
        timeMs: 60_000,
      },
    },
    handler: async ({ text, files: filePaths }, ctx) => {
      const vault = deps.getVault();
      const token = await resolveBotToken(vault);
      if (!token) {
        throw new Error(
          `no Discord bot token configured (set ${DISCORD_TOKEN_ENV} or run \`moxxy channels discord setup\`)`,
        );
      }
      const userId = parseAuthorizedUser(await vault.get(DISCORD_AUTHORIZED_USER_KEY));
      if (!userId) {
        throw new Error('no paired Discord account — run `moxxy channels discord pair` first');
      }

      const files: RawFile[] = (
        await readLocalFiles(filePaths ?? [], {
          cwd: ctx.cwd,
          maxTotalBytes: MAX_UPLOAD_BYTES,
          service: 'Discord',
          limitLabel: '10 MB per bot message',
        })
      ).map((f) => ({ name: f.name, data: f.data }));

      const rest = createRest(token);
      const dm = dmChannelSchema.parse(
        await rest.post(Routes.userChannels(), { body: { recipient_id: userId } }),
      );
      const parts = splitForDiscord(text);
      // Sequential on purpose: parts must arrive in order. Files ride on the
      // last part, so they land right under the text that introduces them.
      for (const [index, content] of parts.entries()) {
        const last = index === parts.length - 1;
        await rest.post(Routes.channelMessages(dm.id), {
          body: { content, allowed_mentions: { parse: [] } },
          ...(last && files.length > 0 ? { files } : {}),
        });
      }
      return {
        delivered: true,
        userId,
        parts: parts.length,
        ...(files.length > 0 ? { files: files.map((f) => f.name) } : {}),
      };
    },
  });
}
