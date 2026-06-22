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
    length?: number;
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
      // Guard even the plain `id`/`cwd` reads: on a foreign/malformed session
      // object over the WS bridge these could be throwing getters, and the
      // contract is that this read-only command never crashes the channel.
      `session:   ${safe(() => s.id) ?? '?'}`,
      `cwd:       ${safe(() => s.cwd) ?? '?'}`,
      `provider:  ${safe(() => s.providers.getActiveName()) ?? '(none)'}`,
      `mode:      ${safe(() => s.modes.getActive()?.name) ?? '(none)'}`,
      // Each registry read is guarded: a flapping/partially-constructed
      // registry (e.g. a plugin host mid-reload or a RemoteSession over the
      // WS bridge) must degrade to `?` rather than throw — handlers must
      // return `{kind:'error'}`, never crash an un-try/catch'd channel.
      `tools:     ${safe(() => s.tools.list().length) ?? '?'}`,
      `skills:    ${safe(() => s.skills.list().length) ?? '?'}`,
      `agents:    ${safe(() => s.agents.list().length) ?? '?'}`,
      `plugins:   ${safe(() => s.pluginHost.list().length) ?? '?'}`,
      `commands:  ${safe(() => s.commands.list().length) ?? '?'}`,
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
    // Guard the registry read the same way `/info` does: a flapping or
    // partially-constructed `commands` registry (plugin host mid-reload, a
    // RemoteSession over the WS bridge) must degrade to a benign message
    // rather than throw — handlers must return `{kind:'error'}`/text, never
    // crash an un-try/catch'd channel (the mobile host's runCommand path).
    // `?? []` also collapses a registry whose `.list()` returns a non-array.
    const all = safe(() => s.commands.list());
    const registered: ReadonlyArray<CommandDef> = Array.isArray(all) ? all : [];
    const visible = registered
      .filter((c) => !c.channels || c.channels.includes(channel))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (visible.length === 0) return { kind: 'text', text: '(no commands registered)' };
    // `/help <command>` — show one command's detail (description + usage).
    // Coerce `args` defensively: the contract types it `string`, but a buggy
    // channel passing `undefined`/non-string must degrade to "list all" rather
    // than crash on `.trim()`.
    const query = String(args ?? '').trim().replace(/^\//, '').toLowerCase();
    if (query) {
      const match = visible.find(
        (c) => c.name === query || (Array.isArray(c.aliases) && c.aliases.includes(query)),
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

/**
 * Guard a status-surface read that must never crash the command pipeline.
 * The swallow is deliberate: for `/info`/`/compact` a flapping registry
 * presents as a benign fallback (`?`/`(none)`/skip) rather than an error —
 * we trade operator diagnostics for the hard guarantee that a read-only
 * status command can never throw an un-try/catch'd channel down.
 */
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
  // Prefer the cheap `length` over `slice()` (which materializes the whole
  // array — runManualCompaction slices it again internally); fall back to a
  // bounded probe only when length is absent, and treat an unknown length as
  // non-empty so runManualCompaction's own empty guard makes the final call.
  const knownLength = safe(() => s.log?.length);
  const isEmpty =
    typeof knownLength === 'number'
      ? knownLength === 0
      : (safe(() => s.log?.slice?.())?.length ?? 1) === 0;
  if (isEmpty) {
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
  // Resolve model/window inside the guard too: a malformed/foreign provider
  // (e.g. one passed over the WS bridge) whose `.models` is a throwing getter
  // or a non-array would otherwise throw here, escaping the try/catch below.
  const firstModel = safe(() => provider?.models?.[0]) ?? undefined;
  const model = firstModel?.id;
  const contextWindow = firstModel?.contextWindow;

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
