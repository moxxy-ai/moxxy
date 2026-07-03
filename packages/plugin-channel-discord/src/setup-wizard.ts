import { cancel, intro, isCancel, log, note, outro, password, select } from '@clack/prompts';
import type { ChannelSubcommandContext } from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';
import {
  DISCORD_ALLOWED_CHANNELS_KEY,
  DISCORD_AUTHORIZED_USER_KEY,
  DISCORD_TOKEN_ENV,
  DISCORD_TOKEN_KEY,
  DISCORD_TOKEN_RE,
  parseAllowedChannels,
  parseAuthorizedUser,
} from './keys.js';
import { runPairFlow } from './pair-flow.js';

// Tiny zero-dep ANSI helpers (bold + dim) so this wizard stays inside the
// plugin without depending on the CLI's colors module.
const ANSI = process.stdout.isTTY && !process.env.NO_COLOR;
const bold = (s: string): string => (ANSI ? `\x1b[1m${s}\x1b[22m` : s);
const dim = (s: string): string => (ANSI ? `\x1b[2m${s}\x1b[22m` : s);

interface State {
  readonly hasToken: boolean;
  readonly authorizedUserId: string | null;
  readonly allowedChannelCount: number;
}

type Action = 'set-token' | 'pair' | 'unpair' | 'start' | 'quit';

/**
 * Interactive Discord setup menu — invoked as the channel's
 * `interactiveCommand` when the user runs `moxxy discord` with no subcommand
 * in a TTY. Headless invocations bypass it and start the bot directly.
 *
 * Menu offers actions appropriate to the current state:
 *   - no token            -> "Set bot token" + "Quit"
 *   - token, not paired   -> "Pair a Discord account" + "Change token" + "Quit"
 *   - token + paired      -> "Start bot" + "Unpair" + "Change token" + "Quit"
 */
export async function runDiscordWizard(ctx: ChannelSubcommandContext): Promise<number> {
  const vault = ctx.deps.vault as VaultStore;

  intro(bold('moxxy discord setup'));

  while (true) {
    const state = await readState(vault);
    printStatus(state);
    const action = await pickAction(state);
    if (action === null) {
      cancel('cancelled.');
      return 0;
    }
    if (action === 'quit') {
      outro(dim('done.'));
      return 0;
    }
    if (action === 'set-token') {
      await actionSetToken(vault);
      continue;
    }
    if (action === 'pair') {
      return await runPairFlow(ctx);
    }
    if (action === 'unpair') {
      await vault.delete(DISCORD_AUTHORIZED_USER_KEY);
      log.success('Unpaired. Run pairing again to authorize an account.');
      continue;
    }
    if (action === 'start') {
      log.info('Starting the bot. Press Ctrl+C to stop.');
      outro(dim('handing off to bot...'));
      return ctx.startChannel();
    }
  }
}

async function readState(vault: VaultStore): Promise<State> {
  // env beats vault for the token (matches the channel's own precedence) so
  // the wizard reflects what the bot would actually see at start time.
  const envToken = process.env[DISCORD_TOKEN_ENV];
  const vaultToken = envToken ?? (await vault.get(DISCORD_TOKEN_KEY));
  const authorized = await vault.get(DISCORD_AUTHORIZED_USER_KEY);
  const allowed = parseAllowedChannels(await vault.get(DISCORD_ALLOWED_CHANNELS_KEY));
  return {
    hasToken: !!vaultToken,
    authorizedUserId: parseAuthorizedUser(authorized),
    allowedChannelCount: allowed.length,
  };
}

function printStatus(state: State): void {
  const lines: string[] = [];
  lines.push(`Token           ${state.hasToken ? bold('set') : dim('not set')}`);
  lines.push(
    `Paired account  ${state.authorizedUserId != null ? bold(state.authorizedUserId) : dim('none')}`,
  );
  lines.push(
    `Guild channels  ${state.allowedChannelCount > 0 ? bold(String(state.allowedChannelCount)) : dim('none allow-listed (DM works once paired)')}`,
  );
  note(lines.join('\n'), 'status');
}

async function pickAction(state: State): Promise<Action | null> {
  const options: Array<{ value: Action; label: string; hint?: string }> = [];
  if (state.hasToken && state.authorizedUserId != null) {
    options.push({
      value: 'start',
      label: 'Start the bot',
      hint: 'runs forever - Ctrl+C to stop',
    });
    options.push({
      value: 'unpair',
      label: 'Unpair this account',
      hint: 'pairing must be run again before the bot answers anyone',
    });
  } else if (state.hasToken) {
    options.push({
      value: 'pair',
      label: 'Pair a Discord account',
      hint: 'DM the bot; it replies with a code you paste here',
    });
  }
  options.push({
    value: 'set-token',
    label: state.hasToken ? 'Change the bot token' : 'Set the bot token',
    hint: state.hasToken ? undefined : 'create an app + bot at discord.com/developers',
  });
  options.push({ value: 'quit', label: 'Quit' });

  const choice = await select<Action>({ message: 'What do you want to do?', options });
  if (isCancel(choice)) return null;
  return choice as Action;
}

async function actionSetToken(vault: VaultStore): Promise<boolean> {
  note(
    'Open https://discord.com/developers/applications, create an application, add a Bot,\n' +
      'and copy its token (Bot → Reset Token). IMPORTANT: on the same Bot page, under\n' +
      '"Privileged Gateway Intents", enable ' +
      bold('MESSAGE CONTENT INTENT') +
      ' — without it the bot\n' +
      'receives empty messages. The token goes straight into the moxxy vault under\n' +
      "'" +
      DISCORD_TOKEN_KEY +
      "' - no env var needed.",
    'get a bot token',
  );
  const token = await password({
    message: 'Paste the Discord bot token',
    mask: '•',
    validate: (v) => {
      if (!v || v.trim().length === 0) return 'required';
      if (!DISCORD_TOKEN_RE.test(v.trim())) {
        return 'doesn\'t look like a Discord bot token - expected three dot-separated segments';
      }
      return undefined;
    },
  });
  if (isCancel(token)) return false;
  await vault.set(DISCORD_TOKEN_KEY, String(token).trim(), ['discord']);
  log.success('Token stored in vault.');
  return true;
}
