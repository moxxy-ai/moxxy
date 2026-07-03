import { cancel, intro, isCancel, log, note, outro, select, text } from '@clack/prompts';
import type { ChannelSubcommandContext } from '@moxxy/sdk';
import { moxxyPath } from '@moxxy/sdk/server';
import type { VaultStore } from '@moxxy/plugin-vault';
import { createFileAuthStorage, hasStoredCreds } from './auth-state.js';
import { ensureConsentInteractive } from './consent-prompt.js';
import {
  WHATSAPP_ALLOWED_JIDS_KEY,
  WHATSAPP_AUTH_DIR,
  WHATSAPP_OWNER_JID_KEY,
  parseAllowedJids,
} from './keys.js';
import { runWhatsAppPairFlow } from './pair-flow.js';

// Tiny zero-dep ANSI helpers so the wizard stays inside the plugin.
const ANSI = process.stdout.isTTY && !process.env.NO_COLOR;
const bold = (s: string): string => (ANSI ? `\x1b[1m${s}\x1b[22m` : s);
const dim = (s: string): string => (ANSI ? `\x1b[2m${s}\x1b[22m` : s);

interface State {
  readonly linked: boolean;
  readonly ownerJid: string | null;
  readonly allowedJids: ReadonlyArray<string>;
}

type Action = 'pair' | 'unpair' | 'allow-list' | 'start' | 'quit';

/**
 * Interactive WhatsApp setup menu (the channel's `interactiveCommand`).
 *
 * The FIRST step — before any menu — is the consent gate: this channel rides an
 * UNOFFICIAL WhatsApp client; the wizard states the ToS/ban risk plainly and
 * requires a typed "yes" before anything else. No acknowledgment, no menu.
 */
export async function runWhatsAppWizard(ctx: ChannelSubcommandContext): Promise<number> {
  const vault = ctx.deps.vault as VaultStore;
  intro(bold('moxxy whatsapp setup'));

  if (!(await ensureConsentInteractive(vault))) {
    cancel('cancelled.');
    return 1;
  }

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
    if (action === 'pair') {
      return await runWhatsAppPairFlow(ctx);
    }
    if (action === 'unpair') {
      await unpairLocal(vault);
      log.success(
        'Local credentials cleared. Also remove the device on your phone: WhatsApp -> Settings -> Linked devices.',
      );
      continue;
    }
    if (action === 'allow-list') {
      await editAllowList(vault, state.allowedJids);
      continue;
    }
    if (action === 'start') {
      log.info('Starting the channel. Press Ctrl+C to stop.');
      outro(dim('handing off to the channel...'));
      return ctx.startChannel();
    }
  }
}

/** Clear the rotating auth-state dir + the persisted owner identity. */
export async function unpairLocal(vault: VaultStore): Promise<boolean> {
  const storage = createFileAuthStorage(moxxyPath(WHATSAPP_AUTH_DIR));
  const had = await hasStoredCreds(storage);
  await storage.clear();
  await vault.delete(WHATSAPP_OWNER_JID_KEY).catch(() => undefined);
  return had;
}

async function readState(vault: VaultStore): Promise<State> {
  const storage = createFileAuthStorage(moxxyPath(WHATSAPP_AUTH_DIR));
  return {
    linked: await hasStoredCreds(storage),
    ownerJid: await vault.get(WHATSAPP_OWNER_JID_KEY),
    allowedJids: parseAllowedJids(await vault.get(WHATSAPP_ALLOWED_JIDS_KEY)),
  };
}

function printStatus(state: State): void {
  const lines: string[] = [];
  lines.push(`Linked       ${state.linked ? bold(state.ownerJid ?? 'yes') : dim('no')}`);
  lines.push(
    `Allow-list   ${
      state.allowedJids.length > 0
        ? bold(state.allowedJids.join(', '))
        : dim('only your own Note-to-Self chat')
    }`,
  );
  note(lines.join('\n'), 'status');
}

async function pickAction(state: State): Promise<Action | null> {
  const options: Array<{ value: Action; label: string; hint?: string }> = [];
  if (state.linked) {
    options.push({
      value: 'start',
      label: 'Start the channel',
      hint: 'runs forever - Ctrl+C to stop',
    });
    options.push({
      value: 'unpair',
      label: 'Unpair (forget local credentials)',
      hint: 'also remove the device under Linked devices on the phone',
    });
  } else {
    options.push({
      value: 'pair',
      label: 'Link a WhatsApp account (scan QR)',
      hint: 'WhatsApp -> Settings -> Linked devices -> Link a device',
    });
  }
  options.push({
    value: 'allow-list',
    label: 'Edit the JID allow-list',
    hint: 'who besides your own Note-to-Self chat may talk to the agent',
  });
  options.push({ value: 'quit', label: 'Quit' });

  const choice = await select<Action>({ message: 'What do you want to do?', options });
  if (isCancel(choice)) return null;
  return choice as Action;
}

async function editAllowList(
  vault: VaultStore,
  current: ReadonlyArray<string>,
): Promise<void> {
  note(
    'Comma-separated JIDs, e.g. 15551234567@s.whatsapp.net (a group JID ends in\n' +
      '@g.us — allow-listing a group trusts EVERYONE in it). Empty input clears the\n' +
      'list; your own Note-to-Self chat is always allowed.',
    'allow-list',
  );
  const answer = await text({
    message: 'Allowed JIDs',
    initialValue: current.join(', '),
    placeholder: '15551234567@s.whatsapp.net',
  });
  if (isCancel(answer)) return;
  const parsed = parseAllowedJids(String(answer));
  await vault.set(WHATSAPP_ALLOWED_JIDS_KEY, JSON.stringify(parsed), ['whatsapp']);
  log.success(
    parsed.length > 0 ? `Allow-list saved (${parsed.length} JIDs).` : 'Allow-list cleared.',
  );
}
