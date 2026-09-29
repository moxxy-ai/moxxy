import { REST, Routes } from 'discord.js';
import { defineTool, z, type ToolDef } from '@moxxy/sdk';
import {
  DISCORD_AUTHORIZED_USER_KEY,
  DISCORD_TOKEN_ENV,
  parseAuthorizedUser,
  resolveBotToken,
} from '../keys.js';
import { splitForDiscord } from '../render.js';

/** The slice of discord.js `REST` this tool uses (the real client satisfies it). */
export interface DiscordRestPoster {
  post(route: `/${string}`, options?: { body?: unknown }): Promise<unknown>;
}

export interface DiscordSendMessageToolDeps {
  readonly getVault: () => { get(name: string): Promise<string | null> };
  /** Build the REST client for a token. Defaults to a one-off discord.js `REST`. */
  readonly createRest?: (token: string) => DiscordRestPoster;
}

/** Cap on one push — a handful of Discord messages once split. */
const MAX_TEXT_CHARS = 8_000;

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
      'markdown is rendered as-is; long text is split into several messages. Requires a ' +
      'stored bot token + a paired account (`moxxy channels discord setup`).',
    inputSchema: z.object({
      text: z.string().trim().min(1).max(MAX_TEXT_CHARS),
    }),
    permission: { action: 'prompt' },
    isolation: {
      capabilities: {
        fs: { read: ['~/.moxxy/vault.*'] },
        net: { mode: 'allowlist', hosts: ['discord.com'] },
        env: [DISCORD_TOKEN_ENV],
        timeMs: 60_000,
      },
    },
    handler: async ({ text }) => {
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

      const rest = createRest(token);
      const dm = dmChannelSchema.parse(
        await rest.post(Routes.userChannels(), { body: { recipient_id: userId } }),
      );
      const parts = splitForDiscord(text);
      // Sequential on purpose: parts must arrive in order.
      for (const content of parts) {
        await rest.post(Routes.channelMessages(dm.id), {
          body: { content, allowed_mentions: { parse: [] } },
        });
      }
      return { delivered: true, userId, parts: parts.length };
    },
  });
}
