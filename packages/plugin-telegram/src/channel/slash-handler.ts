import { type Bot, type Context, InlineKeyboard } from 'grammy';
import { assertDefined, isSelectableMode } from '@moxxy/sdk';
import type { ClientSession as Session } from '@moxxy/sdk';
import { resolveVoiceToggle } from '@moxxy/channel-kit';

/**
 * Install guidance shown when enabling `/voice` with no active synthesizer —
 * mirrors the voice-handler's transcriber guidance wording, pointing at the TTS
 * plugin instead of the STT one.
 */
export const VOICE_NO_SYNTH_HINT =
  'No text-to-speech backend is configured yet, so replies stay text-only. Install one with `moxxy plugins install tts-openai` and run `moxxy login openai` (or set OPENAI_API_KEY) to enable spoken replies.';

export interface SlashState {
  readonly session: Session | null;
  readonly model: string | undefined;
  readonly activeModelOverride: string | null;
  readonly yolo: boolean;
  /** Whether voice replies are currently enabled (backs `/voice status`). */
  readonly voiceReplies: boolean;
}

export interface SlashCallbacks {
  /** Toggle yolo and return its new value (so we can echo the right message). */
  toggleYolo(): boolean;
  /** Persist + apply the voice-replies preference (backs `/voice on|off`). */
  setVoiceReplies(on: boolean): Promise<void>;
  /** Apply a `session-action` result emitted from a registered command. */
  performSessionAction(
    ctx: Context,
    action: 'new' | 'clear' | 'exit',
    notice: string | undefined,
  ): Promise<void>;
}

/**
 * Slash-command dispatcher for the Telegram channel.
 *
 * First tries the shared `session.commands` registry — this is where
 * the universal commands (/info, /clear, /new, /exit, /help) live, so
 * Telegram gets them for free alongside any plugin-contributed
 * commands without needing a switch case here.
 *
 * Falls through to channel-local cases for Telegram-specific UI
 * (model/loop pickers as inline keyboards, /yolo toggle, /tools and
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
      await renderModelPicker(ctx, session, state, args);
      return;
    case '/mode':
      await renderModePicker(ctx, session);
      return;
    case '/yolo': {
      const enabled = cb.toggleYolo();
      await ctx.reply(
        enabled
          ? '⚠ yolo mode ON — tool calls auto-approved for the rest of this session'
          : 'yolo mode OFF — tool prompts will resume',
      );
      return;
    }
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

/** Telegram inline keyboards get unwieldy past this many rows; cap the picker. */
const MODEL_PICKER_CAP = 30;

async function renderModelPicker(
  ctx: Context,
  session: Session,
  state: SlashState,
  filter = '',
): Promise<void> {
  const providers = session.providers.list();
  if (providers.length === 0) {
    await ctx.reply('no providers registered');
    return;
  }
  const keyboard = new InlineKeyboard();
  const providerName = session.providers.getActiveName() ?? '';
  const activeModel = state.activeModelOverride ?? state.model ?? '';
  // Same boot-time readiness set the TUI uses to flag unconfigured
  // providers — set by `@moxxy/cli` at setup time. Providers that
  // failed credential resolution get a "(not connected)" suffix
  // and a tap on them surfaces the right setup command instead of
  // a no-op switch.
  const ready = session.readyProviders ?? new Set<string>();
  // `/model <substring>` narrows the list so a model that sorts past the
  // keyboard cap is still reachable from chat (the cap below would otherwise
  // silently hide it with no fallback).
  const needle = filter.trim().toLowerCase();
  // Flatten so we can both apply the substring filter and report how many the
  // cap hides (vs. how many the filter excluded).
  const all = providers.flatMap((p) =>
    p.models.map((m) => ({ provider: p.name, model: m.id })),
  );
  const matched = needle
    ? all.filter((e) => `${e.provider}::${e.model}`.toLowerCase().includes(needle))
    : all;
  if (matched.length === 0) {
    await ctx.reply(`no model matches "${filter.trim()}" — try /model with no argument.`);
    return;
  }
  const shown = matched.slice(0, MODEL_PICKER_CAP);
  for (const e of shown) {
    const isCurrent = providerName === e.provider && activeModel === e.model;
    const connected = ready.has(e.provider);
    const label =
      `${isCurrent ? '• ' : ''}${e.provider}: ${e.model}` +
      (connected ? '' : ' (not connected)');
    keyboard.text(label, `model:${e.provider}::${e.model}`).row();
  }
  const hidden = matched.length - shown.length;
  const prompt =
    hidden > 0
      ? `Pick a model (${hidden} more not shown — narrow with /model <text>):`
      : 'Pick a model:';
  await ctx.reply(prompt, { reply_markup: keyboard });
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
    { command: 'model', description: 'Switch provider + model (inline keyboard)' },
    { command: 'mode', description: 'Switch mode' },
    { command: 'yolo', description: 'Toggle auto-approve mode' },
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
