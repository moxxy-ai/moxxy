import { cancel, intro, isCancel, log, note, outro, password, text } from '@clack/prompts';
import type { ChannelSubcommandContext } from '@moxxy/sdk';
import type { VaultStore } from '@moxxy/plugin-vault';
import {
  IMESSAGE_ALLOWED_HANDLES_KEY,
  IMESSAGE_OWNER_HANDLES_KEY,
  IMESSAGE_SERVER_PASSWORD_KEY,
  IMESSAGE_SERVER_URL_KEY,
  isHandle,
  normalizeHandle,
  parseHandleList,
} from './keys.js';
import { BlueBubblesClient } from './bluebubbles-client.js';

const ANSI = process.stdout.isTTY && !process.env.NO_COLOR;
const bold = (s: string): string => (ANSI ? `\x1b[1m${s}\x1b[22m` : s);
const dim = (s: string): string => (ANSI ? `\x1b[2m${s}\x1b[22m` : s);

/**
 * Interactive iMessage (BlueBubbles) setup wizard (the channel's
 * `interactiveCommand`).
 *
 * Walks the operator through:
 *   1. the BlueBubbles server URL + password (stored in the vault),
 *   2. a best-effort reachability check against that server,
 *   3. the handle allow-list — who besides yourself may talk to the agent,
 *   4. your own handle(s), so texting your own "self-chat" reaches moxxy,
 *   5. the autonomous tool allow-list,
 * then starts the channel.
 */
export async function runImessageWizard(ctx: ChannelSubcommandContext): Promise<number> {
  const vault = ctx.deps.vault as VaultStore;
  intro(bold('moxxy imessage setup'));

  note(
    'moxxy talks to iMessage through a BlueBubbles server running on THIS Mac.\n' +
      'Install it from https://bluebubbles.app, sign in to Messages, and set a\n' +
      'server password. This channel uses the stock apple-script send method — no\n' +
      'SIP changes or Private API needed. v1 handles 1:1 text chats only.',
    'how the iMessage channel works',
  );

  const existingUrl = await vault.get(IMESSAGE_SERVER_URL_KEY);
  const serverUrl = await text({
    message: 'BlueBubbles server URL',
    placeholder: 'http://localhost:1234',
    initialValue: existingUrl ?? 'http://localhost:1234',
    validate: (v) => {
      if (!v || !v.trim()) return 'required';
      try {
        // eslint-disable-next-line no-new
        new URL(v.trim());
        return undefined;
      } catch {
        return 'expected a URL, e.g. http://localhost:1234';
      }
    },
  });
  if (isCancel(serverUrl)) {
    cancel('cancelled.');
    return 0;
  }
  const url = String(serverUrl).trim();

  const serverPassword = await password({
    message: 'BlueBubbles server password',
    validate: (v) => (v && v.length > 0 ? undefined : 'required'),
  });
  if (isCancel(serverPassword)) {
    cancel('cancelled.');
    return 0;
  }
  const pass = String(serverPassword);

  await vault.set(IMESSAGE_SERVER_URL_KEY, url, ['imessage']);
  await vault.set(IMESSAGE_SERVER_PASSWORD_KEY, pass, ['imessage']);
  log.success('Stored the BlueBubbles server URL + password in the vault.');

  // Best-effort reachability probe — the ping only uses fetch, no socket.
  try {
    await new BlueBubblesClient({ serverUrl: url, password: pass }).ping();
    log.success('Reached the BlueBubbles server.');
  } catch (err) {
    log.warn(
      `Could not reach the server yet: ${err instanceof Error ? err.message : String(err)}\n` +
        'You can still finish setup — the channel will retry when it starts.',
    );
  }

  const allowAnswer = await text({
    message: 'Handles allowed to talk to moxxy (comma-separated E.164 numbers / Apple-ID emails)',
    placeholder: '+15551234567, friend@icloud.com',
    initialValue: parseHandleList(await vault.get(IMESSAGE_ALLOWED_HANDLES_KEY)).join(', '),
  });
  if (isCancel(allowAnswer)) {
    cancel('cancelled.');
    return 0;
  }
  const allowed = parseHandleInput(String(allowAnswer));
  await vault.set(IMESSAGE_ALLOWED_HANDLES_KEY, JSON.stringify(allowed), ['imessage']);
  log.success(
    allowed.length > 0
      ? `Allow-list saved (${allowed.length} handle(s)).`
      : 'Allow-list cleared (no external senders allowed).',
  );

  note(
    'To talk to moxxy from your OWN Apple devices (texting your "self-chat"),\n' +
      'add your own iMessage handle(s) below. Leave blank to keep self-chat off —\n' +
      "your outbound messages to other people are never treated as prompts.",
    'your own handles (self-chat)',
  );
  const ownerAnswer = await text({
    message: 'Your own handle(s) (comma-separated; blank to skip)',
    placeholder: '+15559876543, you@icloud.com',
    initialValue: parseHandleList(await vault.get(IMESSAGE_OWNER_HANDLES_KEY)).join(', '),
  });
  if (isCancel(ownerAnswer)) {
    cancel('cancelled.');
    return 0;
  }
  const owner = parseHandleInput(String(ownerAnswer));
  await vault.set(IMESSAGE_OWNER_HANDLES_KEY, JSON.stringify(owner), ['imessage']);
  log.success(
    owner.length > 0 ? `Self-chat enabled for ${owner.length} handle(s).` : 'Self-chat left off.',
  );

  const allowToolsAnswer = await text({
    message: 'Autonomous tool allow-list (comma-separated; "*" = all, blank = read-only)',
    placeholder: 'Read, Grep, Glob',
  });
  if (isCancel(allowToolsAnswer)) {
    cancel('cancelled.');
    return 0;
  }
  const allowedTools = String(allowToolsAnswer)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  log.info('Starting the channel. Press Ctrl+C to stop.');
  outro(dim('handing off to the channel…'));
  return ctx.startChannel({ allowedTools });
}

/** Split comma/whitespace-separated handle input, normalize, drop non-handles. */
function parseHandleInput(raw: string): string[] {
  const out = new Set<string>();
  for (const token of raw.split(/[,\s]+/)) {
    if (!token) continue;
    const handle = normalizeHandle(token);
    if (isHandle(handle)) out.add(handle);
  }
  return [...out];
}
