import type { ClientSession as Session } from '@moxxy/sdk';
import type { ChannelLogger } from './discord-like.js';

export interface SlashCallbacks {
  /** Toggle yolo and return its new value (so we can echo the right message). */
  toggleYolo(): boolean;
  /** Handle `/voice [on|off|status]` — persist + apply, return the reply text. */
  voice(arg: string): Promise<string>;
  /** Apply a `session-action` result emitted from a registered command. */
  performSessionAction(action: 'new' | 'clear' | 'exit', notice: string | undefined): Promise<string>;
}

/**
 * Slash-command dispatcher shared by the plain-text path (`/info` typed as a
 * message) and the application-command path (a real Discord slash command —
 * the interaction handler routes both here). Returns the reply text to send.
 *
 * First tries the shared `session.commands` registry — the universal commands
 * (/info, /clear, /new, /exit, /help) plus plugin-contributed ones — then
 * falls through to Discord-local cases (/yolo, /tools, /skills). /cancel and
 * /allow, /deny are handled by the message/interaction layer (they need channel
 * state this dispatcher doesn't carry).
 */
export async function runSlash(
  name: string,
  args: string,
  session: Session,
  cb: SlashCallbacks,
): Promise<string> {
  const registered = session.commands.get(name);
  if (registered) {
    try {
      const result = await registered.handler({
        channel: 'discord',
        sessionId: session.id,
        args,
        session,
      });
      if (result.kind === 'text') return result.text;
      if (result.kind === 'session-action') {
        return cb.performSessionAction(result.action, result.notice);
      }
      if (result.kind === 'error') return `error: ${result.message}`;
      return `✓ /${name}`;
    } catch (err) {
      return `command /${name} failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  switch (name) {
    case 'yolo': {
      const enabled = cb.toggleYolo();
      return enabled
        ? '⚠ yolo mode ON — tool calls auto-approved for the rest of this session'
        : 'yolo mode OFF — tool prompts will resume';
    }
    case 'voice':
      return cb.voice(args);
    case 'tools': {
      const list = session.tools
        .list()
        .map((t) => `${t.name} — ${t.description}`)
        .join('\n');
      return list || '(no tools registered)';
    }
    case 'skills': {
      const list = session.skills
        .list()
        .map((s) => `${s.frontmatter.name} — ${s.frontmatter.description}`)
        .join('\n');
      return list || '(no skills discovered)';
    }
    default:
      return `unknown command: /${name} (try /help)`;
  }
}

/** Discord application-command name constraint. */
const COMMAND_NAME_RE = /^[a-z0-9_-]{1,32}$/;

export interface AppCommandJson {
  readonly name: string;
  readonly description: string;
}

/**
 * Build the application-command list to publish: the shared registry commands
 * (parity with Telegram's `publishBotCommands`) plus the Discord-local ones.
 * Names that don't fit Discord's `^[a-z0-9_-]{1,32}$` constraint are skipped
 * (they remain reachable as plain-text `/name` messages); descriptions are
 * clamped to Discord's 1..100 chars.
 */
export function buildAppCommands(session: Session): AppCommandJson[] {
  const LOCAL: AppCommandJson[] = [
    { name: 'yolo', description: 'Toggle auto-approve mode' },
    { name: 'voice', description: 'Toggle spoken voice replies' },
    { name: 'tools', description: 'List the tools the active session can call' },
    { name: 'skills', description: 'List the discovered skills' },
    { name: 'cancel', description: 'Abort the current turn' },
    { name: 'allow', description: 'Allow this guild channel to drive moxxy (paired user only)' },
    { name: 'deny', description: 'Remove this guild channel from the allow-list' },
  ];
  const shared = session.commands
    .listForChannel('discord')
    .map((c) => ({ name: c.name, description: c.description }));
  const seen = new Set(shared.map((c) => c.name));
  return [...shared, ...LOCAL.filter((c) => !seen.has(c.name))]
    .filter((c) => COMMAND_NAME_RE.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ name: c.name, description: (c.description || c.name).slice(0, 100) || c.name }));
}

/** The slice of a discord.js application-command manager we publish through. */
export interface AppCommandPublisher {
  set(commands: ReadonlyArray<AppCommandJson>): Promise<unknown>;
}

/**
 * Publish the commands to Discord so they appear in the client's "/" picker.
 * Best-effort: a network failure here doesn't block channel startup — the
 * commands still work as plain-text messages.
 */
export async function publishAppCommands(
  publisher: AppCommandPublisher | null,
  session: Session | null,
  logger?: ChannelLogger,
): Promise<void> {
  if (!publisher || !session) return;
  try {
    await publisher.set(buildAppCommands(session));
  } catch (err) {
    logger?.warn('discord commands.set failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
