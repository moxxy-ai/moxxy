import { confirm, isCancel, log, outro, spinner } from '@clack/prompts';
import type { ChannelSubcommandContext } from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';
import { SlackChannel, type PairCandidate } from './channel.js';

const ANSI = process.stdout.isTTY && !process.env.NO_COLOR;
const dim = (s: string): string => (ANSI ? `\x1b[2m${s}\x1b[22m` : s);

/**
 * Drive the TOFU pairing flow end-to-end.
 *
 *   1. Build a SlackChannel from the subcommand ctx + wire the session's
 *      permission resolver.
 *   2. Subscribe to pair candidates BEFORE starting so the first @mention can't
 *      race past us.
 *   3. Start in `pair` mode (opens the tunnel; prints the Request URL).
 *   4. Wait (with spinner) for the first verified inbound event.
 *   5. Ask the operator to confirm the team/channel; on yes, persist it.
 *   6. Hand off the running bot until Ctrl+C.
 *
 * Uses the default `proxyTunnel` provider (the channel imports it directly), so
 * the public Request URL is available once the channel starts.
 */
export async function runSlackPairFlow(ctx: ChannelSubcommandContext): Promise<number> {
  const session = ctx.session;
  const channel = new SlackChannel({
    vault: ctx.deps.vault as VaultStore,
    logger: ctx.deps.logger as never,
  });
  session.setPermissionResolver(channel.permissionResolver);

  let candidateResolve: ((c: PairCandidate) => void) | null = null;
  const firstCandidate = new Promise<PairCandidate>((resolve) => {
    candidateResolve = resolve;
  });
  const unsubscribe = channel.onPairCandidate((c) => {
    candidateResolve?.(c);
    candidateResolve = null;
  });

  outro(dim('opening pairing window…'));

  let handle;
  try {
    handle = await channel.start({ session, pair: true });
  } catch (err) {
    unsubscribe();
    log.error(`Could not start the Slack channel: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const stopBot = async (): Promise<void> => {
    unsubscribe();
    try {
      await handle.stop('wizard');
    } catch {
      /* ignore */
    }
  };

  if (channel.requestUrl) {
    log.info(
      `Slack Request URL (paste into Event Subscriptions):\n  ${channel.requestUrl}\n` +
        'Then mention the bot (@your-bot) in a channel to pair.',
    );
  }

  const spin = spinner();
  spin.start('Waiting for the first @mention from Slack…');

  let candidate: PairCandidate;
  try {
    candidate = await firstCandidate;
  } catch (err) {
    spin.stop('pairing aborted');
    log.error(`Pairing aborted: ${err instanceof Error ? err.message : String(err)}`);
    await stopBot();
    return 1;
  }
  spin.stop(`Got an event from team ${candidate.teamId}, channel ${candidate.channelId}.`);

  const ok = await confirm({
    message: `Authorize team ${candidate.teamId} / channel ${candidate.channelId}?`,
  });
  if (isCancel(ok) || !ok) {
    log.warn('Pairing not confirmed.');
    await stopBot();
    return 0;
  }

  await channel.confirmPairing(candidate);
  log.success(`Paired ✓ — team ${candidate.teamId} is authorized.`);
  log.info('Bot is running. Press Ctrl+C to stop.');

  const shutdown = async (): Promise<void> => {
    await stopBot();
    await session.close('SIGINT').catch(() => undefined);
    process.exit(0);
  };
  const onSignal = (): void => void shutdown();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    await handle.running;
    return 0;
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
}
