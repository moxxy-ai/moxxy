import { isCancel, log, outro, spinner, text } from '@clack/prompts';
import { exitAfterPairRequested, type ChannelSubcommandContext } from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';
import { DiscordChannel } from './channel.js';

// Tiny zero-dep ANSI dim helper, so this flow stays inside the plugin.
const ANSI = process.stdout.isTTY && !process.env.NO_COLOR;
const dim = (s: string): string => (ANSI ? `\x1b[2m${s}\x1b[22m` : s);

/** How many wrong codes the operator may paste before we give up. */
const MAX_CODE_ATTEMPTS = 5;

/**
 * Drive the DM code pairing flow end-to-end in a terminal.
 *
 * Steps:
 *   1. Build a DiscordChannel from the subcommand ctx and wire the session's
 *      permission resolver.
 *   2. Start the bot with the pairing window armed (`pair: true`).
 *   3. Tell the user to DM the bot (from the account that should own it) —
 *      the bot replies to that DM with a one-time code.
 *   4. Prompt for the code here; on match that account is authorized and
 *      persisted.
 *   5. Keep the bot running until Ctrl+C (mirrors the Telegram pair flow).
 */
export async function runPairFlow(ctx: ChannelSubcommandContext): Promise<number> {
  const session = ctx.session;
  const channel = new DiscordChannel({
    vault: ctx.deps.vault as VaultStore,
    token: (ctx.deps.options?.['token'] as string | undefined) ?? undefined,
    logger: ctx.deps.logger as never,
  });
  session.setPermissionResolver(channel.permissionResolver);

  outro(dim('starting the bot with a pairing window armed...'));

  const handle = await channel.start({ session, pair: true });

  const stopBot = async (): Promise<void> => {
    try {
      await handle.stop('wizard');
    } catch {
      /* ignore */
    }
  };

  // Already paired (no window armed): nothing to confirm. Tell the user how
  // to re-pair rather than prompting for a code that can never arrive.
  if (channel.connected) {
    log.info(
      'This bot is already paired. Run `moxxy channels discord unpair` first to pair a different account.',
    );
    await stopBot();
    return 0;
  }

  if (channel.requestUrl) {
    log.info(`Invite the bot to a server (needed once so you can DM it):\n  ${channel.requestUrl}`);
  }
  log.info(
    'Now DM the bot from YOUR Discord account (any message). It replies with a one-time code — paste that code below.',
  );

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

  try {
    let paired = false;
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS && !paired; attempt++) {
      const code = await text({
        message: 'Paste the pairing code from the bot\'s DM reply',
        placeholder: '6-digit code',
        validate: (v) => (!v || !v.trim() ? 'required' : undefined),
      });
      if (isCancel(code)) {
        log.info('Pairing cancelled.');
        await stopBot();
        return 0;
      }
      const result = await channel.confirmPairingCode(String(code));
      if (result.ok) {
        paired = true;
        log.success(`Paired ✓ — Discord user ${result.userId} is authorized.`);
        break;
      }
      log.warn(result.message);
    }
    if (!paired) {
      log.error('Too many failed attempts — pairing aborted. Run `moxxy discord pair` to retry.');
      await stopBot();
      return 1;
    }

    if (exitAfterPairRequested(ctx)) {
      // Orchestrated pairing (`moxxy onboard`): hand control back — the
      // caller starts the bot under its own service afterwards.
      await stopBot();
      return 0;
    }

    const spin = spinner();
    spin.start('Bot is running. Press Ctrl+C to stop.');
    // Only reached if the bot stops on its own (a signal path exits via
    // shutdown()).
    await handle.running;
    spin.stop('bot stopped.');
    return 0;
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
}
