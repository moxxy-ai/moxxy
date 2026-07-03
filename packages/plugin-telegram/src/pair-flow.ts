import { log, outro, spinner } from '@clack/prompts';
import QRCode from 'qrcode';
import { exitAfterPairRequested, type ChannelSubcommandContext } from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';
import { TelegramChannel } from './channel.js';

// Tiny zero-dep ANSI dim helper, so this flow stays inside the plugin.
const ANSI = process.stdout.isTTY && !process.env.NO_COLOR;
const dim = (s: string): string => (ANSI ? `\x1b[2m${s}\x1b[22m` : s);

/**
 * Drive the host-issued QR pairing flow end-to-end in a terminal — the SAME
 * mechanism the desktop Channels panel uses, just rendered inline here.
 *
 * Steps:
 *   1. Build a TelegramChannel from the subcommand ctx and wire the session's
 *      permission resolver.
 *   2. Subscribe to "paired" BEFORE starting the bot so a fast scan can't race us.
 *   3. Start the bot in pairing mode — it mints a code and publishes a
 *      `t.me/<bot>?start=<code>` deep link as `channel.requestUrl`.
 *   4. Render that deep link as a scannable QR (+ the plain link).
 *   5. The user scans / opens the link and taps START (or sends the 6 digits);
 *      the bot authorizes that chat and `onPaired` fires.
 *   6. Hand off SIGINT to keep the bot running until the user Ctrl-Cs.
 */
export async function runPairFlow(ctx: ChannelSubcommandContext): Promise<number> {
  const session = ctx.session;
  const channel = new TelegramChannel({
    vault: ctx.deps.vault as VaultStore,
    token: (ctx.deps.options?.['token'] as string | undefined) ?? undefined,
    logger: ctx.deps.logger as never,
  });
  session.setPermissionResolver(channel.permissionResolver);

  // Subscribe BEFORE start so the first scan can't fire before us.
  let pairedResolve: ((chatId: number) => void) | null = null;
  const paired = new Promise<number>((resolve) => {
    pairedResolve = resolve;
  });
  const unsubscribe = channel.onPaired((chatId) => {
    pairedResolve?.(chatId);
    pairedResolve = null;
  });

  outro(dim('opening pairing window...'));

  // `pair: true` opens the host-issued QR window and resolves the bot's deep link.
  const handle = await channel.start({ session, pair: true });

  // From here on we own the bot lifecycle. Any failure path needs to
  // call stopBot() before returning.
  const stopBot = async (): Promise<void> => {
    unsubscribe();
    try {
      await handle.stop('wizard');
    } catch {
      /* ignore */
    }
  };

  // Already paired (no window was opened): there's nothing to scan. Tell the
  // user how to re-pair rather than hanging on a pairing that can't happen.
  if (channel.connected) {
    log.info(
      'This bot is already paired. Run `moxxy channels telegram unpair` first to pair a different chat.',
    );
    await stopBot();
    return 0;
  }

  const url = channel.requestUrl;
  if (!url) {
    log.error('Could not resolve the bot link — check the token is valid and the network is reachable.');
    await stopBot();
    return 1;
  }

  await printPairQr(url);
  log.info('Scan the QR with your phone (or open the link and tap START) — your chat pairs automatically.');

  // Graceful Ctrl-C while waiting (or once running): stop the bot and exit.
  let stopping = false;
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await stopBot();
    await session.close('SIGINT').catch(() => undefined);
    process.exit(0);
  };
  const onSignal = (): void => void shutdown();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  const spin = spinner();
  spin.start('Waiting for you to pair in Telegram...');
  const chatId = await paired;
  spin.stop(`Paired ✓ — chat ${chatId} is authorized.`);

  if (exitAfterPairRequested(ctx)) {
    // Orchestrated pairing (`moxxy onboard`): hand control back — the caller
    // starts the bot under its own service afterwards. Our SIGINT handlers
    // would `process.exit` the orchestrator, so drop them first.
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    await stopBot();
    return 0;
  }

  log.info('Bot is running. Press Ctrl+C to stop.');
  try {
    // Only reached if the bot stops on its own (a signal path exits via
    // shutdown()); remove our handlers so they don't outlive this flow.
    await handle.running;
    return 0;
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
}

/** Render the pairing deep link as a scannable terminal QR + the plain link. */
async function printPairQr(url: string): Promise<void> {
  let qr = '';
  try {
    qr = await QRCode.toString(url, { type: 'terminal', small: true });
  } catch {
    qr = '';
  }
  // CLI surface — intentional stdout.
  console.log(['', qr, `  link: ${url}`, ''].join('\n'));
}
