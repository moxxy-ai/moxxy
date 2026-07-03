import { cancel, intro, isCancel, log, note, outro, text } from '@clack/prompts';
import type { ChannelSubcommandContext } from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';
import { E164_RE, SIGNAL_ACCOUNT_KEY } from './keys.js';
import { SIGNAL_CLI_INSTALL_HINT, findSignalCliOnPath, listSignalAccounts } from './sidecar.js';
import { runSignalPairFlow } from './pair-flow.js';

const ANSI = process.stdout.isTTY && !process.env.NO_COLOR;
const bold = (s: string): string => (ANSI ? `\x1b[1m${s}\x1b[22m` : s);
const dim = (s: string): string => (ANSI ? `\x1b[2m${s}\x1b[22m` : s);

/**
 * Interactive Signal setup wizard (the channel's `interactiveCommand`).
 *
 * Walks the operator through:
 *   1. verify the `signal-cli` binary is installed (install hint when missing),
 *   2. store the account number (E.164) in the vault — no API token exists for
 *      Signal; identity comes from device linking,
 *   3. choose the autonomous tool allow-list,
 *   4. hand off to the pair flow (QR link) when the account isn't linked yet,
 *      or start the channel directly when it is.
 */
export async function runSignalWizard(ctx: ChannelSubcommandContext): Promise<number> {
  const vault = ctx.deps.vault as VaultStore;
  intro(bold('moxxy signal setup'));

  const binary = findSignalCliOnPath();
  if (!binary) {
    log.error(SIGNAL_CLI_INSTALL_HINT);
    return 1;
  }
  log.success(`Found signal-cli: ${binary}`);

  note(
    'moxxy joins your Signal account as a LINKED DEVICE (like Signal Desktop).\n' +
      'It will see the messages your account receives, so it runs on its own\n' +
      'dedicated, isolated runner. After linking, message your own "Note to Self"\n' +
      'to talk to moxxy; other senders must be allow-listed explicitly.',
    'how the Signal channel works',
  );

  const existing = await vault.get(SIGNAL_ACCOUNT_KEY);
  const account = await text({
    message: 'Your Signal account number (E.164)',
    placeholder: '+15551234567',
    ...(existing ? { initialValue: existing } : {}),
    validate: (v) => {
      if (!v || !v.trim()) return 'required';
      if (!E164_RE.test(v.trim())) return 'expected E.164, e.g. +15551234567';
      return undefined;
    },
  });
  if (isCancel(account)) {
    cancel('cancelled.');
    return 0;
  }
  const accountNumber = String(account).trim();
  await vault.set(SIGNAL_ACCOUNT_KEY, accountNumber, ['signal']);
  log.success(`Stored account ${accountNumber} in the vault.`);

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

  // Linked already? (one-shot listAccounts spawn; on probe failure fall through
  // to the pair flow, which handles the already-linked case gracefully too).
  let linked = false;
  try {
    linked = (await listSignalAccounts({ binary })).includes(accountNumber);
  } catch {
    linked = false;
  }

  if (linked) {
    log.info('This machine is already linked. Starting the channel…');
    outro(dim('handing off to the channel…'));
    return ctx.startChannel({ allowedTools });
  }

  note(
    'Next: link this machine to your Signal account. A QR will appear —\n' +
      'on your phone open Signal → Settings → Linked Devices → Link New Device\n' +
      'and scan it. signal-cli keeps the linked-device keys in\n' +
      '~/.local/share/signal-cli/ (moxxy stores only the number + allow-list).',
    'link your phone',
  );
  outro(dim('opening the linking QR…'));
  return runSignalPairFlow(ctx, { allowedTools });
}
