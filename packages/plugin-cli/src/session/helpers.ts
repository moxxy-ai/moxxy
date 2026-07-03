import type { ClientSession as Session, ModeBadge } from '@moxxy/sdk';
import {
  BUILTIN_SLASH_COMMANDS,
  type SlashCommand,
} from '../components/SlashCommands.js';
import type { CommandDef } from '@moxxy/sdk';

export function resolveActiveModel(
  session: Session,
  override: string | null,
  prop: string | undefined,
): string {
  if (override) return override;
  if (prop) return prop;
  try {
    return session.providers.getActive().models[0]?.id ?? 'default';
  } catch {
    return 'default';
  }
}

export function resolveContextWindow(session: Session, activeModel: string): number | null {
  try {
    const provider = session.providers.getActive();
    const match = provider.models.find((m) => m.id === activeModel);
    return match?.contextWindow ?? provider.models[0]?.contextWindow ?? null;
  } catch {
    return null;
  }
}

export function buildSlashSuggestions(session: Session): ReadonlyArray<SlashCommand> {
  const fromRegistry: SlashCommand[] = session.commands
    .listForChannel('tui')
    .map((c: CommandDef) => ({
      name: c.name,
      description: c.description,
      ...(c.argumentHint ? { argumentHint: c.argumentHint } : {}),
      ...(c.aliases ? { aliases: c.aliases } : {}),
    }));
  const seen = new Set(fromRegistry.map((c) => c.name));
  const tuiLocal = BUILTIN_SLASH_COMMANDS.filter((c) => !seen.has(c.name));
  return [...fromRegistry, ...tuiLocal].sort((a, b) => a.name.localeCompare(b.name));
}

export function resolveActiveDescriptor(
  session: Session,
  activeModel: string,
): { supportsImages?: boolean } | null {
  try {
    const provider = session.providers.getActive();
    return provider.models.find((m) => m.id === activeModel) ?? null;
  } catch {
    return null;
  }
}

export function getModeName(session: Session): string {
  try {
    return session.modes.getActive().name;
  } catch {
    return '(none)';
  }
}

/**
 * Presentation badge for the active mode, if it declares one. Sourced from
 * the serializable `getInfo()` snapshot rather than `modes.getActive().badge`
 * so it also resolves over the thin-client transport (a `RemoteSession`'s
 * mode objects are name-only stubs). `null` when no badge / no active mode.
 */
export function getModeBadge(session: Session): ModeBadge | null {
  try {
    return session.getInfo().activeModeBadge;
  } catch {
    return null;
  }
}

export function formatTokensShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

/**
 * Group MCP tools (those prefixed `mcp__<server>__*`) by server name
 * for the SkillsPanel summary. Reads the live tool registry — only
 * servers whose tools are currently registered appear, so the section
 * reflects the actual catalog the model can call right now.
 */
export function deriveMcpServers(
  tools: ReadonlyArray<{ readonly name: string }>,
): ReadonlyArray<{ name: string; toolCount: number; toolNames: ReadonlyArray<string> }> {
  const grouped = new Map<string, string[]>();
  for (const t of tools) {
    const m = /^mcp__([a-z0-9-]+)__/.exec(t.name);
    if (!m) continue;
    const server = m[1]!;
    const list = grouped.get(server) ?? [];
    list.push(t.name);
    grouped.set(server, list);
  }
  return [...grouped.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, toolNames]) => ({ name, toolCount: toolNames.length, toolNames }));
}

/**
 * Wipe the visible terminal AND its scrollback buffer.
 *
 * Why this is needed: `<Static>` items in Ink commit to the terminal's
 * scrollback once and stay there forever — Ink's render loop can't
 * reach up and erase already-printed lines. `/clear` and `/new` empty
 * the React state and the event log, but the historical text the user
 * already scrolled past remains in the terminal's history. Emitting
 * the ANSI sequence is the only way to truly start fresh.
 *
 *   \x1b[3J  — clear scrollback (xterm extension; widely supported)
 *   \x1b[2J  — clear visible viewport
 *   \x1b[H   — move cursor to home (0,0)
 *
 * Ink's next paint draws the (now-empty) chat + bottom UI cleanly.
 *
 * Set `MOXXY_KEEP_SCROLLBACK=1` to skip the irreversible scrollback wipe
 * (`\x1b[3J`): screen-reader users and anyone relying on terminal history can
 * then keep prior context after /clear and /new. The visible viewport is still
 * cleared so the fresh session renders cleanly. Callers should pair this with a
 * spoken systemNotice ("session cleared") so assistive tech reads the state
 * change.
 */
export function clearTerminalScreen(): void {
  if (process.stdout.isTTY) {
    const keepScrollback = process.env.MOXXY_KEEP_SCROLLBACK === '1';
    process.stdout.write(keepScrollback ? '\x1b[2J\x1b[H' : '\x1b[3J\x1b[2J\x1b[H');
  }
}


/**
 * Ctrl+<letter> hotkey overrides from `tui.keys` (projected to the
 * MOXXY_TUI_KEYS env by the CLI launcher). Only single ascii letters are
 * honored; anything else — bad JSON, multi-char values, collisions with the
 * fixed voice key — falls back to the defaults so a bad config can't brick
 * the editor.
 */
export interface TuiKeyOverrides {
  readonly forceSend: string;
  readonly dropQueued: string;
  readonly toggleTools: string;
}

const TUI_KEY_DEFAULTS: TuiKeyOverrides = { forceSend: 't', dropQueued: 'b', toggleTools: 'o' };

export function parseTuiKeyOverrides(raw: string | undefined): TuiKeyOverrides {
  if (!raw) return TUI_KEY_DEFAULTS;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return TUI_KEY_DEFAULTS;
  }
  const pick = (key: keyof TuiKeyOverrides): string => {
    const v = parsed[key];
    return typeof v === 'string' && /^[a-z]$/.test(v) && v !== 'r' ? v : TUI_KEY_DEFAULTS[key];
  };
  const out = { forceSend: pick('forceSend'), dropQueued: pick('dropQueued'), toggleTools: pick('toggleTools') };
  // A collision (two actions on one letter) reverts to defaults wholesale.
  const letters = new Set([out.forceSend, out.dropQueued, out.toggleTools]);
  return letters.size === 3 ? out : TUI_KEY_DEFAULTS;
}
