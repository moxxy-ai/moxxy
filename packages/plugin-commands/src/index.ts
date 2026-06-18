import {
  definePlugin,
  runManualCompaction,
  type CommandDef,
  type CompactorDef,
  type EmittedEvent,
  type EventLogReader,
  type LLMProvider,
  type MoxxyEvent,
  type Plugin,
} from '@moxxy/sdk';

/**
 * Minimal shape we expect on the `ctx.session` argument. Loose typing
 * keeps this package free of a core dependency — the host always
 * passes a real Session that satisfies this surface.
 */
interface SessionShape {
  readonly id: string;
  readonly cwd: string;
  readonly providers: { getActiveName(): string | null };
  readonly modes: { getActive(): { name: string } | undefined };
  readonly tools: { list(): ReadonlyArray<unknown> };
  readonly skills: { list(): ReadonlyArray<unknown> };
  readonly agents: { list(): ReadonlyArray<{ name: string; description: string }> };
  readonly commands: { list(): ReadonlyArray<CommandDef> };
  readonly pluginHost: { list(): ReadonlyArray<unknown> };
}

interface CompactSessionShape {
  readonly id?: string;
  readonly signal?: AbortSignal;
  readonly log: EventLogReader & {
    append(event: EmittedEvent): Promise<MoxxyEvent>;
    asReader?(): EventLogReader;
  };
  readonly compactors: { getActive(): CompactorDef | null };
  readonly providers?: { getActive(): LLMProvider };
}

const infoCmd: CommandDef = {
  name: 'info',
  description: 'Show provider · model · mode · plugin/skill counts',
  handler: ({ session }) => {
    const s = session as SessionShape;
    const lines = [
      `session:   ${s.id}`,
      `cwd:       ${s.cwd}`,
      `provider:  ${safe(() => s.providers.getActiveName()) ?? '(none)'}`,
      `mode:      ${safe(() => s.modes.getActive()?.name) ?? '(none)'}`,
      `tools:     ${s.tools.list().length}`,
      `skills:    ${s.skills.list().length}`,
      `agents:    ${s.agents.list().length}`,
      `plugins:   ${s.pluginHost.list().length}`,
      `commands:  ${s.commands.list().length}`,
    ];
    return { kind: 'text', text: lines.join('\n') };
  },
};

const clearCmd: CommandDef = {
  name: 'clear',
  description: 'Clear the chat scrollback (event log stays intact in resumed sessions)',
  handler: () => ({ kind: 'session-action', action: 'clear', notice: 'scrollback cleared' }),
};

const newCmd: CommandDef = {
  name: 'new',
  description: 'Start a fresh session (drops conversation history; keeps provider/loop)',
  handler: () => ({
    kind: 'session-action',
    action: 'new',
    notice: 'new session — conversation history cleared',
  }),
};

const compactCmd: CommandDef = {
  name: 'compact',
  description: 'Manually compact old conversation context now',
  pendingNotice: 'compacting context...',
  handler: async ({ session }) => compactSession(session),
};

const exitCmd: CommandDef = {
  name: 'exit',
  description: 'Quit the current channel',
  aliases: ['quit', 'q'],
  handler: () => ({ kind: 'session-action', action: 'exit' }),
};

const helpCmd: CommandDef = {
  name: 'help',
  description: 'List every command available in this channel',
  argumentHint: '[command]',
  handler: ({ session, channel, args }) => {
    const s = session as SessionShape;
    const visible = s.commands
      .list()
      .filter((c) => !c.channels || c.channels.includes(channel))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (visible.length === 0) return { kind: 'text', text: '(no commands registered)' };
    // `/help <command>` — show one command's detail (description + usage).
    const query = args.trim().replace(/^\//, '').toLowerCase();
    if (query) {
      const match = visible.find(
        (c) => c.name === query || c.aliases?.includes(query),
      );
      if (!match) return { kind: 'text', text: `no command named "/${query}" (try /help)` };
      const lines = [`/${match.name}  —  ${match.description}`];
      if (match.argumentHint) lines.push(`usage: /${match.name} ${match.argumentHint}`);
      if (match.aliases?.length) lines.push(`aliases: ${match.aliases.map((a) => `/${a}`).join(', ')}`);
      return { kind: 'text', text: lines.join('\n') };
    }
    const longest = visible.reduce((m, c) => Math.max(m, c.name.length), 0);
    const lines = visible.map(
      (c) => `/${c.name.padEnd(longest)}  ${c.description}${c.argumentHint ? ` ${c.argumentHint}` : ''}`,
    );
    return { kind: 'text', text: lines.join('\n') };
  },
};

/**
 * `@moxxy/plugin-commands` — registers the channel-agnostic command
 * set every channel inherits via `session.commands`. Drop it and
 * those commands disappear; the TUI's channel-local pickers (model,
 * loop, mcp, yolo, overlay-style stuff) keep working since they
 * remain inside the TUI itself.
 */
export const commandsPlugin: Plugin = definePlugin({
  name: '@moxxy/plugin-commands',
  version: '0.0.0',
  commands: [infoCmd, clearCmd, newCmd, compactCmd, exitCmd, helpCmd],
});

export default commandsPlugin;

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

async function compactSession(session: unknown) {
  const s = session as CompactSessionShape;
  const compactor = s.compactors?.getActive?.();
  if (!compactor) return { kind: 'error' as const, message: 'no active compactor configured' };

  // Distinguish an empty log up front so we can keep the specific
  // message — `runManualCompaction` collapses every no-op (empty log,
  // zero saving, blank summary) into the same `compacted: false`.
  const events = s.log?.slice?.() ?? [];
  if (events.length === 0) {
    return { kind: 'text' as const, text: 'nothing to compact: event log is empty' };
  }

  // Resolve the active provider/model so the default summarize compactor
  // writes a REAL model summary (degrades to a lossy truncation otherwise),
  // plus the model's real context window. We don't know which model id the
  // user picked from this surface, so use the first-listed model's window as
  // the conventional default (matches resolveContextWindow in plugin-cli).
  // When no provider is wired (rare; tests), the helper falls back to a
  // MAX_SAFE_INTEGER window — fine, since `/compact` forces past the gate.
  const provider = safe(() => s.providers?.getActive()) ?? undefined;
  const model = provider?.models[0]?.id;
  const contextWindow = provider?.models[0]?.contextWindow;

  try {
    // Delegate the whole pipeline (budget build, compact(), no-op guard,
    // defensive sessionId/turnId/source fill, append, replaced-range count)
    // to the single shared SDK helper. The plugin only formats the message.
    const result = await runManualCompaction({
      compactor,
      log: s.log,
      signal: s.signal,
      ...(provider ? { provider } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(s.id !== undefined ? { sessionId: s.id } : {}),
    });

    if (!result.compacted) {
      return { kind: 'text' as const, text: 'nothing to compact yet' };
    }

    return {
      kind: 'text' as const,
      text: `context compacted: ${formatCount(result.eventsCompacted)} ${plural(result.eventsCompacted, 'event')}, ~${formatTokenCount(result.tokensSaved)} tokens saved`,
    };
  } catch (err) {
    return {
      kind: 'error' as const,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${trimFixed(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimFixed(value / 1_000)}k`;
  return formatCount(value);
}

function trimFixed(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}

function plural(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}
