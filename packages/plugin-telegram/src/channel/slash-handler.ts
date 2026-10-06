import { type Bot, type Context, InlineKeyboard } from 'grammy';
import { assertDefined, isSelectableMode } from '@moxxy/sdk';
import type { ClientSession as Session } from '@moxxy/sdk';
import { resolveVoiceToggle } from '@moxxy/channel-kit';
import { providerScreen } from './model-picker.js';
import type { TelegramModel } from './model.js';

/**
 * Install guidance shown when enabling `/voice` with no active synthesizer —
 * mirrors the voice-handler's transcriber guidance wording, pointing at the TTS
 * plugin instead of the STT one.
 */
export const VOICE_NO_SYNTH_HINT =
  'No text-to-speech backend is configured yet, so replies stay text-only. Install one with `moxxy plugins install tts-openai` and run `moxxy login openai` (or set OPENAI_API_KEY) to enable spoken replies.';

export interface SlashState {
  readonly session: Session | null;
  /** Whether voice replies are currently enabled (backs `/voice status`). */
  readonly voiceReplies: boolean;
}

export interface SlashCallbacks {
  /** Switch the conversation's shared auto-approve; returns its new value. */
  toggleYolo(): Promise<boolean>;
  /** Persist + apply the voice-replies preference (backs `/voice on|off`). */
  setVoiceReplies(on: boolean): Promise<void>;
  /** This bot's own model (`/model`). */
  readonly model: Pick<TelegramModel, 'run' | 'choices'>;
  /** Apply a `session-action` result emitted from a registered command. */
  performSessionAction(
    ctx: Context,
    action: 'new' | 'clear' | 'exit',
    notice: string | undefined,
  ): Promise<void>;
}

/** Telegram bots have no calls; a voice message is the way to talk. */
export const NO_CALLS_REPLY =
  'Telegram does not let bots take or place calls. Send me a voice message instead — I will answer with one.';

/**
 * Slash-command dispatcher for the Telegram channel.
 *
 * First tries the shared `session.commands` registry — this is where
 * the universal commands (/info, /clear, /new, /exit, /help) live, so
 * Telegram gets them for free alongside any plugin-contributed
 * commands without needing a switch case here.
 *
 * Falls through to channel-local cases for Telegram-specific UI
 * (model/mode pickers as inline keyboards, /auto-approve, /tools and
 * /skills as text dumps).
 */
export async function runSlash(
  ctx: Context,
  text: string,
  state: SlashState,
  cb: SlashCallbacks,
): Promise<void> {
  const session = state.session;
  if (!session) return;
  const [head, ...rest] = text.split(/\s+/);
  assertDefined(head, 'String.split always yields at least one element');
  const name = head.slice(1);
  const args = rest.join(' ');

  // 1) Shared registry dispatch.
  const registered = session.commands.get(name);
  if (registered) {
    try {
      const result = await registered.handler({
        channel: 'telegram',
        sessionId: session.id,
        args,
        session,
      });
      if (result.kind === 'text') {
        await ctx.reply(result.text);
      } else if (result.kind === 'session-action') {
        await cb.performSessionAction(ctx, result.action, result.notice);
      } else if (result.kind === 'error') {
        await ctx.reply(`error: ${result.message}`);
      }
    } catch (err) {
      await ctx.reply(
        `command /${name} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return;
  }

  // 2) Channel-local cases.
  switch (head) {
    case '/model':
      if (args.trim()) await ctx.reply(await cb.model.run(args));
      else await renderModelPicker(ctx, cb.model);
      return;
    case '/mode':
      await renderModePicker(ctx, session);
      return;
    case '/auto-approve':
    case '/auto_approve':
    case '/yolo': {
      const enabled = await cb.toggleYolo();
      await ctx.reply(
        enabled
          ? '⚠ auto-approve ON — tool calls run without asking for the rest of this session'
          : 'auto-approve OFF — tool prompts will resume',
      );
      return;
    }
    case '/call':
      await ctx.reply(NO_CALLS_REPLY);
      return;
    case '/voice': {
      const result = resolveVoiceToggle({
        arg: args,
        enabled: state.voiceReplies,
        hasSynthesizer: session.synthesizers.tryGetActive() != null,
        delivery: 'a voice note',
        noSynthesizerHint: VOICE_NO_SYNTH_HINT,
      });
      if (result.persist) await cb.setVoiceReplies(result.enabled);
      await ctx.reply(result.reply);
      return;
    }
    case '/tools': {
      const list = session.tools
        .list()
        .map((t) => `${t.name} — ${t.description}`)
        .join('\n');
      await ctx.reply(list || '(no tools registered)');
      return;
    }
    case '/skills': {
      const list = session.skills
        .list()
        .map((s) => {
          const triggers = s.frontmatter.triggers ?? [];
          const triggerLine = triggers.length
            ? `\n   triggers: ${triggers.map((t) => `"${t}"`).join(', ')}`
            : '';
          return `${s.frontmatter.name} — ${s.frontmatter.description}${triggerLine}`;
        })
        .join('\n');
      await ctx.reply(list || '(no skills discovered)');
      return;
    }
    default:
      await ctx.reply(`unknown command: ${head} (try /help)`);
  }
}

/** `/model` without an argument: the providers first (see model-picker). */
async function renderModelPicker(ctx: Context, model: Pick<TelegramModel, 'choices'>): Promise<void> {
  const { current, options } = await model.choices();
  const screen = providerScreen(current, options);
  await ctx.reply(screen.text, { parse_mode: 'HTML', reply_markup: screen.keyboard });
}

async function renderModePicker(ctx: Context, session: Session): Promise<void> {
  // Special modes (e.g. collaborative, entered via /collab) are hidden from the
  // picker the same way they are in the TUI. See ModeDef.special.
  const modes = session.modes.list().filter(isSelectableMode);
  if (modes.length === 0) {
    await ctx.reply('no modes registered');
    return;
  }
  const keyboard = new InlineKeyboard();
  const activeModeName = (() => {
    try {
      return session.modes.getActive().name;
    } catch {
      return '';
    }
  })();
  for (const s of modes) {
    const isCurrent = s.name === activeModeName;
    keyboard.text(`${isCurrent ? '• ' : ''}${s.name}`, `mode:${s.name}`).row();
  }
  await ctx.reply('Pick a mode:', { reply_markup: keyboard });
}

/** Telegram's bot-command name constraint (no hyphens). */
const BOT_COMMAND_RE = /^[a-z0-9_]{1,32}$/;

/**
 * Push the union of registry commands + Telegram-local commands to
 * Telegram so they appear in the chat's command menu (the "/" picker
 * the official client shows). Best-effort: a network failure here
 * doesn't block channel startup, the commands still work via text.
 */
export async function publishBotCommands(
  bot: Bot | null,
  session: Session | null,
  logger?: { warn?(msg: string, meta?: Record<string, unknown>): void },
): Promise<void> {
  if (!session || !bot) return;
  const LOCAL: Array<{ command: string; description: string }> = [
    { command: 'model', description: 'Show or switch the model this bot uses' },
    { command: 'mode', description: 'Switch mode' },
    { command: 'auto_approve', description: 'Toggle auto-approve: tool calls run without asking' },
    { command: 'call', description: 'Talk by voice (Telegram bots cannot call — send a voice message)' },
    { command: 'voice', description: 'Toggle spoken voice replies' },
    { command: 'tools', description: 'List the tools the active session can call' },
    { command: 'skills', description: 'List the discovered skills' },
    { command: 'cancel', description: 'Abort the current turn' },
  ];
  const shared = session.commands
    .listForChannel('telegram')
    .map((c) => ({ command: c.name, description: c.description }));
  const seen = new Set(shared.map((c) => c.command));
  const merged = [...shared, ...LOCAL.filter((c) => !seen.has(c.command))]
    // Telegram rejects the whole list over one name outside [a-z0-9_]; such
    // commands still work typed out.
    .filter((c) => BOT_COMMAND_RE.test(c.command))
    .sort((a, b) => a.command.localeCompare(b.command))
    // Telegram caps descriptions at 256 chars and rejects empties.
    .map((c) => ({
      command: c.command,
      description: (c.description || c.command).slice(0, 256),
    }));
  try {
    await bot.api.setMyCommands(merged);
  } catch (err) {
    logger?.warn?.('telegram setMyCommands failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
