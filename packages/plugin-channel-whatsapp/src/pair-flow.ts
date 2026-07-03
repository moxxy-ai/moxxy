import { log, outro, spinner } from '@clack/prompts';
import QRCode from 'qrcode';
import { exitAfterPairRequested, type ChannelSubcommandContext } from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';
import { WhatsAppChannel } from './channel.js';
import { CONSENT_REQUIRED_MESSAGE } from './consent.js';
import { ensureConsentInteractive } from './consent-prompt.js';

// Tiny zero-dep ANSI dim helper, so this flow stays inside the plugin.
const ANSI = process.stdout.isTTY && !process.env.NO_COLOR;
const dim = (s: string): string => (ANSI ? `\x1b[2m${s}\x1b[22m` : s);

/**
 * Drive the QR device-link pairing flow end-to-end in a terminal — the SAME
 * mechanism the desktop Channels panel uses (it renders `channel.requestUrl`
 * from the status file), just rendered inline here.
 *
 * Unlike Telegram's one-shot deep link, the Baileys QR payload ROTATES every
 * ~20-60s while unlinked, so the flow re-renders on every connect-change until
 * the scan lands.
 */
export async function runWhatsAppPairFlow(ctx: ChannelSubcommandContext): Promise<number> {
  const vault = ctx.deps.vault as VaultStore;

  // Consent gate FIRST — pairing is the moment the account actually links.
  if (!(await ensureConsentInteractive(vault))) {
    process.stderr.write(`${CONSENT_REQUIRED_MESSAGE}\n`);
    return 1;
  }

  const session = ctx.session;
  const channel = new WhatsAppChannel({
    vault,
    logger: ctx.deps.logger as never,
  });
  session.setPermissionResolver(channel.permissionResolver);

  // Subscribe BEFORE start so a fast scan can't race us.
  let pairedResolve: ((ownerJid: string) => void) | null = null;
  const paired = new Promise<string>((resolve) => {
    pairedResolve = resolve;
  });
  const unsubscribePaired = channel.onPaired((ownerJid) => {
    pairedResolve?.(ownerJid);
    pairedResolve = null;
  });

  outro(dim('opening WhatsApp pairing window...'));
  const handle = await channel.start({ session, pair: true });

  const stopChannel = async (): Promise<void> => {
    unsubscribePaired();
    try {
      await handle.stop('pair flow');
    } catch {
      /* ignore */
    }
  };

  if (channel.connected) {
    log.info(
      'A WhatsApp account is already linked. Run `moxxy channels whatsapp unpair` first to link a different one.',
    );
    await stopChannel();
    return 0;
  }

  // Render every FRESH QR payload (they rotate while unlinked).
  let lastQr: string | null = null;
  const renderQr = async (): Promise<void> => {
    const qr = channel.requestUrl;
    if (!qr || qr === lastQr) return;
    lastQr = qr;
    await printPairQr(qr);
    log.info(
      'On your phone: WhatsApp -> Settings -> Linked devices -> Link a device, then scan the QR.',
    );
  };
  const unsubscribeConnect = handle.onConnectChange?.(() => void renderQr()) ?? (() => undefined);
  await renderQr();

  let stopping = false;
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    unsubscribeConnect();
    await stopChannel();
    await session.close('SIGINT').catch(() => undefined);
    process.exit(0);
  };
  const onSignal = (): void => void shutdown();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  const spin = spinner();
  spin.start('Waiting for the scan (the QR refreshes periodically)...');
  const ownerJid = await paired;
  spin.stop(`Linked as ${ownerJid}. Your Note-to-Self chat now talks to moxxy.`);

  if (exitAfterPairRequested(ctx)) {
    // Orchestrated pairing (`moxxy onboard`): hand control back — the caller
    // starts the channel under its own service afterwards. Our SIGINT
    // handlers would `process.exit` the orchestrator, so drop them first.
    unsubscribeConnect();
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    await stopChannel();
    return 0;
  }

  log.info('Channel is running. Press Ctrl+C to stop.');
  try {
    await handle.running;
    return 0;
  } finally {
    unsubscribeConnect();
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
}

/** Render the rotating pairing payload as a scannable terminal QR. */
async function printPairQr(payload: string): Promise<void> {
  let qr = '';
  try {
    qr = await QRCode.toString(payload, { type: 'terminal', small: true });
  } catch {
    qr = '';
  }
  // CLI surface — intentional stdout. (The payload itself is an opaque pairing
  // blob, not a URL, so there is no "open the link" fallback to print.)
  console.log(['', qr].join('\n'));
}
