import type { EventLogReader } from '@moxxy/sdk';
import { z } from 'zod';
import { clipboardFlagsFor, isSystemKeyCombo, parseKeyCombo, type KeyPlatform } from '../contract/keys.js';
import { ComputerUseError } from '../contract/outcome.js';
import type { ComputerAction } from '../contract/tools.js';

export const REQUEST_ACCESS_TOOL = 'computer_request_access';

export const accessTiers = ['read', 'click', 'full'] as const;
export type AccessTier = (typeof accessTiers)[number];
export type AppCategory = 'browser' | 'terminal' | 'trading';

const rank = (tier: AccessTier) => accessTiers.indexOf(tier);

export function maxTier(...tiers: AccessTier[]): AccessTier {
  return tiers.reduce((highest, tier) => (rank(tier) > rank(highest) ? tier : highest), 'read');
}

/**
 * What one approved `computer_request_access` call granted. It is the tool's
 * own result, so the session log already records it for every client and the
 * current access is a pure fold over that log.
 */
export const accessGrantSchema = z.object({
  kind: z.literal('computer_access'),
  granted: z.array(z.object({ id: z.string().min(1).max(512), name: z.string().max(512), tier: z.enum(accessTiers) }).strict()).max(32),
  unresolved: z.array(z.object({
    app: z.string().max(512),
    reason: z.enum(['not_found', 'ambiguous']),
    candidates: z.array(z.object({ id: z.string().max(512), name: z.string().max(512) }).strict()).max(16).optional(),
  }).strict()).max(32),
  clipboard_read: z.boolean(),
  clipboard_write: z.boolean(),
  system_key_combos: z.boolean(),
}).strict();
export type AccessGrant = z.infer<typeof accessGrantSchema>;
export type AppGrant = AccessGrant['granted'][number];

export interface AccessFlags { readonly clipboardRead: boolean; readonly clipboardWrite: boolean; readonly systemKeyCombos: boolean }
export interface AccessState { readonly apps: readonly AppGrant[]; readonly flags: AccessFlags }

/** Current access in a session: approved grants in log order, a later grant of an app replacing the earlier one. */
export function accessFromLog(log: EventLogReader): AccessState {
  const requested = new Set(log.ofType('tool_call_requested').filter((event) => event.name === REQUEST_ACCESS_TOOL).map((event) => event.callId));
  const approved = new Set(log.ofType('tool_call_approved').map((event) => event.callId));
  const apps = new Map<string, AppGrant>();
  const flags = { clipboardRead: false, clipboardWrite: false, systemKeyCombos: false };
  for (const result of log.ofType('tool_result')) {
    if (!result.ok || !requested.has(result.callId) || !approved.has(result.callId)) continue;
    const grant = accessGrantSchema.safeParse(result.output);
    if (!grant.success) continue;
    for (const app of grant.data.granted) apps.set(app.id, app);
    flags.clipboardRead ||= grant.data.clipboard_read;
    flags.clipboardWrite ||= grant.data.clipboard_write;
    flags.systemKeyCombos ||= grant.data.system_key_combos;
  }
  return { apps: [...apps.values()], flags };
}

/** The grant for `app` (identifier or display name) if it allows `needed`. */
export function checkAccess(access: AccessState, app: string, needed: AccessTier): AppGrant {
  const wanted = app.toLowerCase();
  const byId = access.apps.find((grant) => grant.id.toLowerCase() === wanted);
  const byName = access.apps.filter((grant) => grant.name.toLowerCase() === wanted);
  if (!byId && byName.length > 1) {
    throw new ComputerUseError('ambiguous_app', `Several granted apps are named "${app}": ${byName.map((grant) => grant.id).join(', ')}`);
  }
  const grant = byId ?? byName[0];
  if (!grant) throw new ComputerUseError('app_not_allowed', `"${app}" is not granted in this conversation`);
  if (rank(grant.tier) < rank(needed)) {
    throw new ComputerUseError('tier_insufficient', `${grant.name} is granted at the "${grant.tier}" level; this action needs "${needed}"`);
  }
  return grant;
}

/** Lowest grant level that allows a step: reading, a plain left click or scroll, or full control. */
export function requiredTier(step: ComputerAction): AccessTier {
  switch (step.action) {
    case 'scroll': return 'click';
    case 'click': return step.mouse_button === 'left' && step.modifiers === undefined ? 'click' : 'full';
    default: return 'full';
  }
}

/** Refuse system chords and clipboard chords the conversation has not been granted. */
export function checkKeys(step: ComputerAction, flags: AccessFlags, platform: KeyPlatform): void {
  if (step.action !== 'press_key') return;
  const combo = parseKeyCombo(step.key);
  if (isSystemKeyCombo(combo, platform) && !flags.systemKeyCombos) {
    throw new ComputerUseError('system_key_combo', `"${step.key}" acts on the whole system`);
  }
  const missing = clipboardFlagsFor(combo).filter((flag) => !flags[flag]);
  if (missing.length > 0) throw new ComputerUseError('clipboard_not_granted', `"${step.key}" needs ${missing.join(' and ')}`);
}

// Bundle identifiers / Windows executables (a prefix matches its sub-identifiers) and display names
// (a name matches exactly or as the first words) of apps that get a restricted default level.
const KNOWN: Readonly<Record<AppCategory, { readonly ids: readonly string[]; readonly names: readonly string[] }>> = {
  browser: {
    ids: [
      'com.apple.safari', 'com.apple.safaritechnologypreview', 'com.google.chrome', 'com.microsoft.edgemac', 'org.mozilla.firefox',
      'org.mozilla.nightly', 'com.brave.browser', 'com.operasoftware', 'com.vivaldi.vivaldi', 'company.thebrowser', 'org.chromium',
      'app.zen-browser', 'org.torproject.torbrowser', 'com.duckduckgo.macos.browser', 'com.openai.atlas', 'ai.perplexity.comet',
      'com.kagi.kagimacos', 'chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe', 'opera.exe', 'vivaldi.exe', 'arc.exe',
    ],
    names: [
      'safari', 'google chrome', 'chrome', 'chromium', 'firefox', 'microsoft edge', 'brave', 'brave browser', 'opera', 'vivaldi',
      'arc', 'dia', 'tor browser', 'duckduckgo', 'zen', 'zen browser', 'orion', 'atlas', 'comet',
    ],
  },
  terminal: {
    ids: [
      'com.apple.terminal', 'com.googlecode.iterm2', 'dev.warp', 'com.github.wez.wezterm', 'org.alacritty', 'io.alacritty',
      'net.kovidgoyal.kitty', 'co.zeit.hyper', 'com.mitchellh.ghostty', 'com.microsoft.vscode', 'com.vscodium',
      'com.todesktop.230313mzl4w4u92', 'com.exafunction.windsurf', 'dev.zed', 'com.jetbrains', 'com.google.android.studio',
      'com.sublimetext', 'org.vim.macvim', 'org.gnu.emacs', 'com.apple.dt.xcode', 'com.apple.scripteditor2', 'com.apple.automator',
      'com.apple.shortcuts', 'windowsterminal.exe', 'powershell.exe', 'pwsh.exe', 'cmd.exe', 'code.exe', 'cursor.exe',
    ],
    names: [
      'terminal', 'windows terminal', 'iterm', 'iterm2', 'warp', 'wezterm', 'alacritty', 'kitty', 'hyper', 'ghostty',
      'visual studio code', 'code', 'cursor', 'windsurf', 'zed', 'intellij idea', 'pycharm', 'webstorm', 'clion', 'goland', 'rider',
      'android studio', 'xcode', 'sublime text', 'macvim', 'emacs', 'powershell', 'command prompt', 'script editor', 'automator', 'shortcuts',
    ],
  },
  trading: {
    ids: ['com.webull', 'com.tastytrade', 'com.tradingview', 'com.fidelity.activetrader', 'com.binance', 'com.electron.exodus', 'com.ledger.live', 'io.trezor'],
    names: [
      'robinhood', 'webull', 'thinkorswim', 'tradingview', 'tastytrade', 'interactive brokers', 'trader workstation', 'metatrader',
      'binance', 'coinbase', 'kraken', 'ledger live', 'trezor suite', 'exodus', 'electrum',
    ],
  },
};

export function categorize(app: { readonly id: string; readonly name: string }): AppCategory | null {
  const id = app.id.toLowerCase();
  const name = app.name.toLowerCase().trim();
  for (const [category, known] of Object.entries(KNOWN) as Array<[AppCategory, (typeof KNOWN)[AppCategory]]>) {
    if (known.ids.some((prefix) => id === prefix || id.startsWith(`${prefix}.`))) return category;
    if (known.names.some((word) => name === word || name.startsWith(`${word} `))) return category;
  }
  return null;
}

/** Browsers and trading apps are read-only and terminals click-only unless the user approves full access. */
export function defaultTier(category: AppCategory | null): AccessTier {
  if (category === 'browser' || category === 'trading') return 'read';
  if (category === 'terminal') return 'click';
  return 'full';
}
