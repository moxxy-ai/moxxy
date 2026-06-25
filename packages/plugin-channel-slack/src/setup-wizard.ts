import {
  cancel,
  intro,
  isCancel,
  log,
  note,
  outro,
  password,
  spinner,
  text,
} from '@clack/prompts';
import type { ChannelSubcommandContext } from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';
import {
  SLACK_BOT_TOKEN_KEY,
  SLACK_BOT_TOKEN_RE,
  SLACK_SIGNING_SECRET_KEY,
  slackSigningSecretSchema,
} from './keys.js';
import { SlackClient } from './channel/slack-client.js';

const ANSI = process.stdout.isTTY && !process.env.NO_COLOR;
const bold = (s: string): string => (ANSI ? `\x1b[1m${s}\x1b[22m` : s);
const dim = (s: string): string => (ANSI ? `\x1b[2m${s}\x1b[22m` : s);

/**
 * Interactive Slack setup wizard (the channel's `interactiveCommand`).
 *
 * Walks the operator through:
 *   1. paste the bot token (`xoxb-…`) into the vault,
 *   2. paste the signing secret into the vault,
 *   3. validate the token via `auth.test`,
 *   4. choose the working folder + the autonomous tool allow-list,
 *   5. start the channel (opens the proxy tunnel) and PRINT the public Request
 *      URL to paste into the Slack app's Event Subscriptions.
 *
 * Headless invocations bypass this and start the channel directly (the dispatch
 * caller decides; this is only reached on a TTY).
 */
export async function runSlackWizard(ctx: ChannelSubcommandContext): Promise<number> {
  const vault = ctx.deps.vault as VaultStore;
  intro(bold('moxxy slack setup'));

  note(
    'Create a Slack app at https://api.slack.com/apps → "From scratch".\n' +
      '• OAuth & Permissions → add the bot scopes app_mentions:read, chat:write,\n' +
      '  channels:history → Install to Workspace → copy the Bot User OAuth Token (xoxb-…).\n' +
      '• Basic Information → App Credentials → copy the Signing Secret.\n' +
      'Both go straight into the moxxy vault — no env vars needed.',
    'create a Slack app',
  );

  const token = await password({
    message: 'Paste the Bot User OAuth Token',
    mask: '•',
    validate: (v) => {
      if (!v || !v.trim()) return 'required';
      if (!SLACK_BOT_TOKEN_RE.test(v.trim())) return 'expected a token like "xoxb-…"';
      return undefined;
    },
  });
  if (isCancel(token)) {
    cancel('cancelled.');
    return 0;
  }

  const secret = await password({
    message: 'Paste the Signing Secret',
    mask: '•',
    validate: (v) => {
      const parsed = slackSigningSecretSchema.safeParse(v);
      return parsed.success ? undefined : parsed.error.issues[0]?.message ?? 'invalid';
    },
  });
  if (isCancel(secret)) {
    cancel('cancelled.');
    return 0;
  }

  // Validate the token before persisting anything the operator can act on.
  const spin = spinner();
  spin.start('Validating the bot token (auth.test)…');
  try {
    const client = new SlackClient({ token: String(token).trim() });
    const auth = await client.authTest();
    spin.stop(`Token OK — bot user ${auth.botUserId}${auth.team ? ` on ${auth.team}` : ''}.`);
  } catch (err) {
    spin.stop('Token validation failed.');
    log.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  await vault.set(SLACK_BOT_TOKEN_KEY, String(token).trim(), ['slack']);
  await vault.set(SLACK_SIGNING_SECRET_KEY, String(secret).trim(), ['slack']);
  log.success('Stored bot token + signing secret in the vault.');

  const allow = await text({
    message: 'Autonomous tool allow-list (comma-separated; "*" = all, blank = read-only)',
    placeholder: 'Read, Grep, Glob',
  });
  if (isCancel(allow)) {
    cancel('cancelled.');
    return 0;
  }
  const allowedTools = String(allow)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  note(
    'Starting the channel — it opens a proxy tunnel and prints a public Request URL.\n' +
      'Paste that URL into your Slack app → Event Subscriptions → Request URL, then\n' +
      'subscribe to the bot event app_mention. Mention the bot in a channel to pair.',
    'next steps',
  );
  log.info('Starting the bot. Press Ctrl+C to stop.');
  outro(dim('handing off to the channel…'));

  // Start in pairing mode so the first @mention establishes trust automatically.
  return ctx.startChannel({ pair: true, allowedTools });
}
