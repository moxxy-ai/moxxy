import { log, outro, spinner } from '@clack/prompts';
import QRCode from 'qrcode';
import { exitAfterPairRequested, type ChannelSubcommandContext } from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';
import { SignalChannel } from './channel.js';

// Tiny zero-dep ANSI dim helper, so this flow stays inside the plugin.
const ANSI = process.stdout.isTTY && !process.env.NO_COLOR;
const dim = (s: string): string => (ANSI ? `\x1b[2m${s}\x1b[22m` : s);

/**
 * Drive the Signal linked-device pairing end-to-end in a terminal — the SAME
 * mechanism the desktop Channels panel uses (the channel's `pair: true` link
 * window), just rendered inline here.
 *
 * Steps:
 *   1. Build a SignalChannel from the subcommand ctx and wire the session's
 *      permission resolver.
 *   2. Subscribe to "linked" BEFORE starting so a fast scan can't race us.
 *   3. Start the channel in pairing mode — it spawns `signal-cli link` and
 *      publishes the `sgnl://linkdevice…` URI as `channel.requestUrl`.
 *   4. Render that URI as a scannable QR (+ the raw URI).
 *   5. On the phone: Signal → Settings → Linked Devices → Link New Device →
 *      scan; the channel stores the account and boots the daemon.
 *   6. Keep the channel running until the user Ctrl-Cs.
 */
export async function runSignalPairFlow(
  ctx: ChannelSubcommandContext,
  overrides: { readonly allowedTools?: ReadonlyArray<string> } = {},
): Promise<number> {
  const session = ctx.session;
  const channel = new SignalChannel({
    vault: ctx.deps.vault as VaultStore,
    ...(typeof ctx.deps.options?.['account'] === 'string'
      ? { account: ctx.deps.options['account'] as string }
      : {}),
    ...(overrides.allowedTools ? { allowedTools: overrides.allowedTools } : {}),
    logger: ctx.deps.logger as never,
  });
  session.setPermissionResolver(channel.permissionResolver);

  // Subscribe BEFORE start so the first scan can't fire before us.
  let linkedResolve: ((account: string) => void) | null = null;
  const linkedPromise = new Promise<string>((resolve) => {
    linkedResolve = resolve;
  });
  const unsubscribe = channel.onLinked((account) => {
    linkedResolve?.(account);
    linkedResolve = null;
  });

  outro(dim('opening Signal linking window...'));

  const handle = await channel.start({ session, pair: true });

  const stopChannel = async (): Promise<void> => {
    unsubscribe();
    try {
      await handle.stop('pair-flow');
    } catch {
      /* ignore */
    }
  };

  // Already linked (no window was opened): nothing to scan.
  if (channel.connected) {
    log.info(
      'This machine is already linked to a Signal account. The channel is running; ' +
        'to link a different account, remove this device from Signal → Linked Devices first, ' +
        'then run `moxxy channels signal unpair` and pair again.',
    );
    if (exitAfterPairRequested(ctx)) {
      await stopChannel();
      return 0;
    }
    log.info('Press Ctrl+C to stop.');
    installSignalHandlers(stopChannel, session);
    await handle.running;
    return 0;
  }

  const uri = channel.requestUrl;
  if (!uri) {
    log.error('Could not obtain a linking URI from signal-cli.');
    await stopChannel();
    return 1;
  }

  await printLinkQr(uri);
  log.info(
    'On your phone: Signal → Settings → Linked Devices → Link New Device, then scan the QR. ' +
      'The QR expires after a few minutes; re-run `moxxy channels signal pair` if it does.',
  );

  const removeSignalHandlers = installSignalHandlers(stopChannel, session);

  const spin = spinner();
  spin.start('Waiting for you to scan in Signal...');
  const account = await Promise.race([
    linkedPromise,
    handle.running.then(() => null as string | null),
  ]).catch((err: unknown) => {
    spin.stop('Linking failed.');
    log.error(err instanceof Error ? err.message : String(err));
    return null;
  });
  if (account == null) {
    await stopChannel();
    return 1;
  }
  spin.stop(`Linked ✓ — this machine is now a device of ${account}.`);

  if (exitAfterPairRequested(ctx)) {
    // Orchestrated pairing (`moxxy onboard`): hand control back — the caller
    // starts the channel under its own service afterwards. Our SIGINT
    // handlers would `process.exit` the orchestrator, so drop them first.
    removeSignalHandlers();
    await stopChannel();
    return 0;
  }

  log.info(
    'Message your own "Note to Self" in Signal to talk to moxxy. The channel is running; press Ctrl+C to stop.',
  );

  await handle.running;
  return 0;
}

function installSignalHandlers(
  stopChannel: () => Promise<void>,
  session: ChannelSubcommandContext['session'],
): () => void {
  let stopping = false;
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await stopChannel();
    await session.close('SIGINT').catch(() => undefined);
    process.exit(0);
  };
  const onSignal = (): void => void shutdown();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  return () => {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  };
}

/** Render the linking URI as a scannable terminal QR + the raw URI. */
async function printLinkQr(uri: string): Promise<void> {
  let qr = '';
  try {
    qr = await QRCode.toString(uri, { type: 'terminal', small: true });
  } catch {
    qr = '';
  }
  // CLI surface — intentional stdout.
  console.log(['', qr, `  link URI: ${uri}`, ''].join('\n'));
}
