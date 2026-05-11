import { setupSessionWithConfig } from '../setup.js';
import type { ParsedArgv } from '../argv.js';
import { TelegramChannel } from '@moxxy/plugin-telegram';
import { createLogger } from '@moxxy/core';

const TOKEN_ENV = 'MOXXY_TELEGRAM_TOKEN';

export async function runTelegramCommand(argv: ParsedArgv): Promise<number> {
  const sub = argv.positional[0] ?? 'start';
  switch (sub) {
    case 'start':
    case 'pair':
      return await runStart(argv, sub === 'pair');
    case 'unpair':
      return await runUnpair(argv);
    case 'status':
      return await runStatus(argv);
    default:
      process.stderr.write(
        `unknown 'telegram' subcommand: ${sub}\n` +
          `  moxxy telegram         start the bot\n` +
          `  moxxy telegram pair    start the bot and begin a pairing window\n` +
          `  moxxy telegram unpair  forget the authorized chat\n` +
          `  moxxy telegram status  show pairing/token status\n`,
      );
      return 2;
  }
}

async function runStart(argv: ParsedArgv, withPairing: boolean): Promise<number> {
  // Build the channel first so we can install its permission resolver before
  // the session boots. Token comes from env or vault inside the channel.
  const explicitToken = process.env[TOKEN_ENV];

  // Need vault before constructing channel — set up session first, channel second.
  // Provide a temporary deny resolver so setupSession doesn't fail; we swap to
  // the channel's resolver via setActive after both exist.
  const { session, vault } = await setupSessionWithConfig({
    cwd: process.cwd(),
    verbose: Boolean(argv.flags.verbose),
    model: argv.flags.model ? String(argv.flags.model) : undefined,
    configPath: argv.flags.config ? String(argv.flags.config) : undefined,
  });

  const channel = new TelegramChannel({
    vault,
    token: explicitToken,
    logger: argv.flags.verbose ? createLogger({ minLevel: 'debug' }) : undefined,
  });

  // Now that the channel exists, swap its resolver into the session.
  (session as unknown as { resolver: typeof channel.permissionResolver }).resolver =
    channel.permissionResolver;

  if (withPairing) {
    const code = channel.beginPairingWindow();
    process.stderr.write(`\n  Telegram pairing code:  ${code}\n`);
    process.stderr.write('  Send /start to your bot, then type this code in Telegram.\n');
    process.stderr.write('  (Window: 5 minutes)\n\n');
  }

  let handle;
  try {
    handle = await channel.start({
      session,
      model: argv.flags.model ? String(argv.flags.model) : undefined,
    });
  } catch (err) {
    process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  if (!withPairing && channel.pairingPhase() !== 'paired') {
    process.stderr.write(
      'No chat is paired yet. Run `moxxy telegram pair` to start a pairing window first.\n',
    );
    await handle.stop();
    return 1;
  }

  const shutdown = async (): Promise<void> => {
    process.stderr.write('\nstopping telegram channel...\n');
    await handle.stop('SIGINT');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await handle.running;
  return 0;
}

async function runUnpair(argv: ParsedArgv): Promise<number> {
  void argv;
  const { vault } = await setupSessionWithConfig({ cwd: process.cwd() });
  const removed = await vault.delete('telegram_authorized_chat_id');
  process.stdout.write(removed ? 'unpaired\n' : 'no pairing was active\n');
  return 0;
}

async function runStatus(argv: ParsedArgv): Promise<number> {
  void argv;
  const { vault } = await setupSessionWithConfig({ cwd: process.cwd() });
  const hasToken = await vault.has('telegram_bot_token');
  const authorized = await vault.get('telegram_authorized_chat_id');
  process.stdout.write(
    JSON.stringify(
      {
        tokenConfigured: hasToken,
        authorizedChatId: authorized ? Number(authorized) : null,
      },
      null,
      2,
    ) + '\n',
  );
  return 0;
}
