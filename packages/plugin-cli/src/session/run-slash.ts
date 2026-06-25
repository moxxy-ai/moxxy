import type React from 'react';
import { clearUsageStats } from '@moxxy/core';
import { setCategoryDefault } from '@moxxy/config';
import type { ClientSession as Session } from '@moxxy/sdk';
import type { UserPromptAttachment } from '@moxxy/sdk';
import type { ListPickerOption, ListPickerTab } from '../components/ListPicker.js';
import type { Overlay, Picker } from './types.js';
import { formatTokensShort } from './helpers.js';

export interface SlashDeps {
  session: Session;
  providerName: string;
  activeModel: string;
  modeName: string;
  setSystemNotice: (msg: string | null) => void;
  setOverlay: React.Dispatch<React.SetStateAction<Overlay>>;
  setYolo: React.Dispatch<React.SetStateAction<boolean>>;
  setPicker: React.Dispatch<React.SetStateAction<Picker>>;
  queueRef: React.MutableRefObject<Array<{ text: string; attachments: UserPromptAttachment[] }>>;
  setQueueCount: React.Dispatch<React.SetStateAction<number>>;
  performSessionAction: (action: 'new' | 'clear' | 'exit', notice?: string) => void;
  /** Start a turn with the given text (used by /goal to kick off autonomous
   *  work immediately). Does not clear the system notice, unlike handleSubmit. */
  submitPrompt: (text: string) => void;
}

export function runSlash(cmd: string, deps: SlashDeps): void {
  const [head, ...rest] = cmd.split(/\s+/);
  // Guard an empty/whitespace command so this stays safe for any caller (not
  // just handleSubmit, which only calls with a leading "/"). A bare "/" or ""
  // would otherwise slice an empty name and fall through inconsistently.
  if (!head || head === '/') {
    deps.setSystemNotice(`unknown command: ${cmd}   (try /help)`);
    return;
  }
  const name = head.slice(1); // drop leading "/"
  // Case-folded key for the channel-local switch + intercepts below, so
  // `/Queue` resolves the same as `/queue` (the registry lookup keeps the
  // original case to match how plugins registered their command names).
  const key = name.toLowerCase();
  const args = rest.join(' ');

  // First: route through the channel-agnostic command registry.
  // Plugins (/info, /clear, /new, /exit, /help, ...) and any
  // user-defined commands live here.
  // `/workflows` opens an interactive TUI modal (list + enable/disable + run),
  // intercepted BEFORE the command registry so the overlay wins here while
  // non-TUI channels (which don't run this code) still get the text command.
  if (key === 'workflows' || key === 'workflow' || key === 'flows') {
    deps.setSystemNotice(null);
    deps.setOverlay({ kind: 'workflows' });
    return;
  }

  const registered = deps.session.commands.get(name);
  if (registered) {
    void (async () => {
      try {
        if (registered.pendingNotice) deps.setSystemNotice(registered.pendingNotice);
        const result = await registered.handler({
          channel: 'tui',
          sessionId: deps.session.id,
          args,
          session: deps.session,
        });
        if (result.kind === 'text') {
          deps.setSystemNotice(result.text);
        } else if (result.kind === 'session-action') {
          deps.performSessionAction(result.action, result.notice);
        } else if (result.kind === 'error') {
          deps.setSystemNotice(`error: ${result.message}`);
        }
      } catch (err) {
        deps.setSystemNotice(
          `command /${name} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    })();
    return;
  }

  // Channel-local commands the registry can't host because their
  // handlers mutate React state or open Ink overlays. Match against the
  // case-folded key so `/Queue` resolves the same as `/queue`.
  switch (key) {
    case 'queue':
      return handleQueue(deps);
    case 'clear-queue':
      return handleClearQueue(deps);
    case 'tools':
      deps.setSystemNotice(null);
      deps.setOverlay({ kind: 'tools' });
      return;
    case 'skills':
      deps.setSystemNotice(null);
      deps.setOverlay({ kind: 'skills' });
      return;
    case 'agents':
      deps.setSystemNotice(null);
      deps.setOverlay({ kind: 'agents' });
      return;
    case 'usage':
      deps.setSystemNotice(null);
      // `/usage clear` resets the saved cross-session aggregate; bare `/usage`
      // opens the panel. Clearing is a user-only action (no model tool).
      if (args.trim() === 'clear') {
        void clearUsageStats()
          .then(() => deps.setSystemNotice('✓ Cleared saved cross-session usage stats.'))
          .catch((err) =>
            deps.setSystemNotice(
              `failed to clear usage stats: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
        return;
      }
      deps.setOverlay({ kind: 'usage' });
      return;
    case 'model':
      return openModelPicker(deps);
    case 'mcp':
      return openMcpPicker(deps);
    case 'mode':
    case 'loop':
      return openModePicker(deps, args);
    case 'plugins':
      return openPluginsPicker(deps);
    case 'goal':
      return startGoal(deps, args);
    case 'collab':
      return startCollab(deps, args);
    case 'yolo':
    case 'auto-approve':
      deps.setYolo((y) => {
        const next = !y;
        deps.setSystemNotice(
          next
            ? '⚠ yolo mode ON — tool calls auto-approved for the rest of this session'
            : 'yolo mode OFF — tool prompts will resume',
        );
        return next;
      });
      return;
    default:
      deps.setSystemNotice(`unknown command: ${cmd}   (try /help)`);
      return;
  }
}

function handleQueue(deps: SlashDeps): void {
  if (deps.queueRef.current.length === 0) {
    deps.setSystemNotice('no messages queued');
    return;
  }
  const previews = deps.queueRef.current
    .map((q, i) => `${i + 1}. ${q.text.length > 80 ? q.text.slice(0, 77) + '…' : q.text}`)
    .join('\n');
  deps.setSystemNotice(
    `${deps.queueRef.current.length} queued message${deps.queueRef.current.length === 1 ? '' : 's'}:\n${previews}`,
  );
}

function handleClearQueue(deps: SlashDeps): void {
  const n = deps.queueRef.current.length;
  deps.queueRef.current = [];
  deps.setQueueCount(0);
  deps.setSystemNotice(
    n === 0 ? 'queue was already empty' : `dropped ${n} queued message${n === 1 ? '' : 's'}`,
  );
}

function openModelPicker(deps: SlashDeps): void {
  // Build a flat list of all (provider, model) pairs across every
  // registered provider — the user can switch BOTH provider and
  // model in one pick. Grouping is by provider name. Providers whose
  // credentials don't resolve are tagged "not connected".
  const providers = deps.session.providers.list();
  if (providers.length === 0) {
    deps.setSystemNotice('no providers registered');
    return;
  }
  // Re-probe credential readiness live rather than trusting the boot-time
  // snapshot: providers can be added (provider_add) and keys stored (/vault)
  // at runtime, which the boot snapshot never sees. We refresh
  // session.readyProviders so the selection guard (picker-handlers) agrees.
  void (async () => {
    const sess = deps.session;
    let ready = sess.readyProviders ?? new Set<string>();
    if (sess.credentialResolver) {
      const resolver = sess.credentialResolver;
      const fresh = new Set<string>();
      // The active provider is working by definition — always ready, even if
      // a non-interactive re-resolve of its (e.g. OAuth) creds would fail.
      if (deps.providerName) fresh.add(deps.providerName);
      await Promise.all(
        providers.map(async (p) => {
          if (fresh.has(p.name)) return;
          try {
            await resolver(p.name);
            fresh.add(p.name);
          } catch {
            // leave out — not connected
          }
        }),
      );
      ready = fresh;
      sess.readyProviders = fresh;
    }

    // One tab per provider — each tab carries its own searchable list,
    // so the user lands on (e.g.) anthropic and can type "haiku" without
    // wading past 200 unrelated entries from other providers. Tabs that
    // belong to a not-yet-connected provider keep their label but every
    // option inside gets the `not connected` red badge.
    const tabs = providers.map((p) => {
      const isReady = ready.has(p.name);
      const options: ListPickerOption[] = p.models.map((m) => ({
        id: `${p.name}::${m.id}`,
        label: m.id,
        current: deps.providerName === p.name && deps.activeModel === m.id,
        ...(m.contextWindow
          ? { description: `${formatTokensShort(m.contextWindow)} ctx` }
          : {}),
        ...(isReady ? {} : { badge: 'not connected', badgeColor: 'red' as const }),
      }));
      const label = isReady
        ? `${p.name} (${p.models.length})`
        : `${p.name} (offline)`;
      return { id: p.name, label, options };
    });
    deps.setPicker({
      kind: 'model',
      title: 'Switch model',
      tabs,
      initialTabId: deps.providerName,
      searchable: true,
      searchPlaceholder: 'filter models…',
    });
  })();
}

/**
 * Subset of deps `openMcpPicker` actually touches. Exported so the
 * picker-handlers Cancel path can re-open the server list (Cancel in
 * the action picker should walk back to the parent, not close the
 * whole modal) without dragging the rest of SlashDeps along.
 */
export interface OpenMcpPickerDeps {
  setPicker: (p: Picker) => void;
  setSystemNotice: (msg: string | null) => void;
}

export function openMcpPicker(deps: OpenMcpPickerDeps): void {
  // Open a server picker. Selecting one opens the action picker
  // (enable/disable/remove/cancel). MCP catalog state lives in
  // ~/.moxxy/mcp.json; we read it lazily here so changes from the
  // CLI (moxxy mcp ...) show up immediately on next invocation.
  void (async () => {
    try {
      const { readMcpConfig } = await import('@moxxy/plugin-mcp');
      const cfg = await readMcpConfig();
      if (cfg.servers.length === 0) {
        deps.setSystemNotice('no MCP servers registered — add one in chat via mcp_add_server');
        return;
      }
      const options: ListPickerOption[] = cfg.servers.map((s) => {
        const status = s.disabled ? 'disabled' : 'enabled';
        const toolCount = s.cachedTools?.length ?? 0;
        return {
          id: s.name,
          label: s.name,
          description: `${status} · ${toolCount} tool${toolCount === 1 ? '' : 's'}`,
          current: false,
        };
      });
      deps.setPicker({ kind: 'mcp-server', title: 'Pick an MCP server', options });
    } catch (err) {
      deps.setSystemNotice(
        `failed to read MCP catalog: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  })();
}

/** Subset of deps `openPluginsPicker` touches. Exported so picker-handlers can
 *  re-open the picker after a toggle without dragging in all of SlashDeps. */
export interface OpenPluginsPickerDeps {
  session: Session;
  setPicker: (p: Picker) => void;
  setSystemNotice: (msg: string | null) => void;
}

/** Human labels for the per-category default tabs (the swap axis). */
const CATEGORY_LABELS: Record<string, string> = {
  provider: 'Providers',
  mode: 'Modes',
  compactor: 'Compactors',
  cacheStrategy: 'Cache',
  embedder: 'Embedders',
  transcriber: 'Transcribers',
  synthesizer: 'Synthesizers',
  workflowExecutor: 'Workflows',
  viewRenderer: 'Renderers',
  tunnelProvider: 'Tunnels',
  isolator: 'Isolators',
  eventStore: 'Storage',
  channel: 'Channels',
};

function shortPluginName(name: string): string {
  return name.replace(/^@moxxy\/(?:plugin-|mode-|compactor-|cache-strategy-)?/, '');
}

/**
 * `/plugins` — a tabbed picker aligned with the unified `plugins:` manifest's
 * two axes:
 *   - **per-category default tabs** (Providers / Modes / …) — the SWAP axis. Each
 *     lists that category's registered contributions with the active one badged
 *     `current` and the protected floor badged `core`; selecting swaps the
 *     default (`set_default`, persisted + live-applied). Only categories with
 *     something to swap (≥2 contributions) get a tab.
 *   - a **Packages** tab — the ENABLE/DISABLE axis. Loaded packages (with a
 *     `core` badge on the kernel ones that can't be disabled) + disabled ones;
 *     selecting toggles enable/disable.
 *   - an **Installable** tab — the curated catalog of not-yet-installed plugins.
 *
 * Degrades gracefully when `session.pluginsAdmin` is absent (a RemoteSession).
 */
export function openPluginsPicker(deps: OpenPluginsPickerDeps): void {
  const admin = deps.session.pluginsAdmin;
  if (!admin) {
    deps.setSystemNotice('plugin management is not available on this session');
    return;
  }
  const loaded = admin.loaded();
  const disabled = admin.disabled();
  const catalog = admin.catalog();
  const core = new Set<string>(admin.protectedPackages());
  const installed = new Set<string>([...loaded.map((p) => p.name), ...disabled]);

  const tabs: ListPickerTab[] = [];

  // 1. Swap axis — one tab per category with something to swap.
  for (const cat of admin.categories()) {
    if (cat.items.length < 2) continue; // nothing to swap (just the floor)
    tabs.push({
      id: `cat:${cat.category}`,
      label: CATEGORY_LABELS[cat.category] ?? cat.category,
      options: cat.items.map((item) => ({
        id: `${cat.category}::${item.name}::setdefault`,
        label: item.name,
        description: item.isDefault
          ? 'current default'
          : item.name === cat.floor
            ? 'core default — swap, don’t remove'
            : 'select to make this the default',
        current: item.isDefault,
        ...(item.isDefault
          ? { badge: 'current' as const, badgeColor: 'green' as const }
          : item.name === cat.floor
            ? { badge: 'core' as const, badgeColor: 'gray' as const }
            : {}),
      })),
    });
  }

  // 2. Enable/disable axis — every installed package, kernel ones marked.
  const pkgOptions: ListPickerOption[] = [];
  for (const p of [...loaded].sort((a, b) => a.name.localeCompare(b.name))) {
    const isCore = core.has(p.name);
    pkgOptions.push({
      // Kernel packages can't be disabled — a `::core` selection just explains why.
      id: isCore ? `${p.name}::core` : `${p.name}::disable`,
      label: shortPluginName(p.name),
      description: `${p.kinds && p.kinds.length ? p.kinds.join(', ') : 'plugin'} · @${p.version}`,
      badge: isCore ? 'core' : 'on',
      badgeColor: isCore ? 'cyan' : 'green',
    });
  }
  for (const name of [...disabled].sort()) {
    pkgOptions.push({
      id: `${name}::enable`,
      label: shortPluginName(name),
      description: `${name} · disabled`,
      badge: 'off',
      badgeColor: 'gray',
    });
  }
  if (pkgOptions.length > 0) {
    tabs.push({ id: 'packages', label: 'Packages', options: pkgOptions });
  }

  // 3. Installable catalog (not-yet-installed).
  const installable = catalog.filter((e) => !installed.has(e.packageName));
  if (installable.length > 0) {
    tabs.push({
      id: 'installable',
      label: 'Installable',
      options: installable.map((e) => ({
        id: `${e.id}::install`,
        label: e.label,
        description: e.packageName,
        badge: 'not installed',
        badgeColor: 'yellow' as const,
      })),
    });
  }

  if (tabs.length === 0) {
    deps.setSystemNotice('no plugins to show');
    return;
  }
  deps.setPicker({
    kind: 'plugins',
    title: 'Plugins',
    tabs,
    searchable: true,
    searchPlaceholder: 'filter plugins',
  });
}

/**
 * `/goal <objective>` — the autonomous "deliver the outcome" entry point.
 * Switches to the `goal` mode (which keeps working, re-checking each round,
 * until the objective is verifiably delivered), turns on yolo so routine tool
 * calls don't interrupt the run, and — when an objective is given — starts work
 * immediately. Bare `/goal` just arms the mode and waits for the next message.
 * Interrupt anytime with Esc/Ctrl-C.
 */
function startGoal(deps: SlashDeps, arg: string): void {
  const objective = arg.trim();
  const GOAL_MODE = 'goal';
  // The mode is registered globally; if it's somehow absent, say so rather
  // than silently arming yolo with no behavior change.
  if (!deps.session.modes.list().some((m) => m.name === GOAL_MODE)) {
    deps.setSystemNotice('goal mode is not available (mode-goal plugin not loaded)');
    return;
  }
  try {
    deps.session.modes.setActive(GOAL_MODE);
    void setCategoryDefault('mode', GOAL_MODE).catch(() => undefined);
  } catch (err) {
    deps.setSystemNotice(
      `failed to switch to goal mode: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }
  deps.setYolo(() => true);
  deps.setSystemNotice(
    objective
      ? '🎯 goal mode — tools auto-approved; working until the objective is delivered. Press Esc to stop.'
      : '🎯 goal mode on — tools auto-approved. Send your objective as the next message (Esc stops).',
  );
  if (objective) deps.submitPrompt(objective);
}

/**
 * `/collab <goal>` — the agentic-collaborative entry point. Switches to the
 * `collaborative` mode and, when a goal is given, kicks it off immediately: an
 * architect agent designs the plan + contracts and PROPOSES a roster, which
 * surfaces as the usual approval prompt (review/launch/cancel) — then the team
 * of agents runs in parallel and their live status renders inline as the
 * `◆ collab` block. Step in anytime with /collab_say, /collab_direct,
 * /collab_pause, /collab_resume. Bare `/collab` just arms the mode.
 *
 * Unlike /goal it does NOT force yolo: the roster-approval checkpoint (and any
 * conflict escalation) is intentional human-in-the-loop. The spawned peer
 * agents auto-approve inside their own processes.
 */
function startCollab(deps: SlashDeps, arg: string): void {
  const objective = arg.trim();
  const COLLAB_MODE = 'collaborative';
  if (!deps.session.modes.list().some((m) => m.name === COLLAB_MODE)) {
    deps.setSystemNotice('collaborative mode is not available (mode-collaborative plugin not loaded)');
    return;
  }
  try {
    deps.session.modes.setActive(COLLAB_MODE);
    void setCategoryDefault('mode', COLLAB_MODE).catch(() => undefined);
  } catch (err) {
    deps.setSystemNotice(
      `failed to switch to collaborative mode: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }
  deps.setSystemNotice(
    objective
      ? '👥 collaborative mode — the architect is designing the plan; you’ll be asked to approve the team roster. Press Esc to stop.'
      : '👥 collaborative mode on. Send the goal as the next message — an architect will propose a team for you to approve.',
  );
  if (objective) deps.submitPrompt(objective);
}

// Collaboration is launched via `/collab <goal>` (single-flight), not the mode
// picker; its peer modes are internal. Hidden from `/mode`.
const COLLAB_HIDDEN_MODES: ReadonlySet<string> = new Set([
  'collaborative',
  'collab-architect',
  'collab-peer',
]);

function openModePicker(deps: SlashDeps, arg = ''): void {
  const modes = deps.session.modes.list().filter((m) => !COLLAB_HIDDEN_MODES.has(m.name));
  if (modes.length === 0) {
    deps.setSystemNotice('no modes registered');
    return;
  }
  // `/mode <name>` switches directly when the argument names a mode;
  // otherwise (no arg, or no match) fall back to the interactive picker.
  const target = arg.trim().toLowerCase();
  if (target) {
    if (COLLAB_HIDDEN_MODES.has(target)) {
      deps.setSystemNotice('Use /collab <goal> to run a collaborative team (only one runs at a time).');
      return;
    }
    const match = modes.find((m) => m.name.toLowerCase() === target);
    if (match) {
      try {
        deps.session.modes.setActive(match.name);
        deps.setSystemNotice(`mode → ${match.name}`);
        void setCategoryDefault('mode', match.name).catch(() => undefined);
      } catch (err) {
        deps.setSystemNotice(
          `failed to switch mode: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return;
    }
    deps.setSystemNotice(
      `no mode named "${arg.trim()}". Available: ${modes.map((m) => m.name).join(', ')}`,
    );
    return;
  }
  const options: ListPickerOption[] = modes.map((s) => ({
    id: s.name,
    label: s.name,
    current: s.name === deps.modeName,
    ...(s.description ? { description: truncate(s.description, 80) } : {}),
  }));
  deps.setPicker({ kind: 'mode', title: 'Switch mode', options });
}

/**
 * Trim a one-line summary so a long description doesn't overflow the
 * picker row. ListPicker already wraps with `truncate` for column
 * widths, but the picker description column is fluid so we cap at
 * ~80 chars here to keep things sane on narrower terminals too.
 */
function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
