/**
 * Curated catalog of installable plugins plus the pure helpers the
 * `moxxy plugins` CLI and the TUI `/plugins` picker use to render install /
 * enable / disable / remove choices. Formerly `@moxxy/plugin-marketplace`;
 * folded here so plugin install + lifecycle live in one package.
 */
export interface PluginCatalogEntry {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly packageName: string;
  readonly installSpec: string;
  readonly startCommand?: string;
  readonly defaultPort?: number;
  readonly kind?: 'ui' | 'runtime' | 'cli';
  /**
   * Registry contributions this package provides, so surfaces can offer
   * "install on first use" at the point a missing capability is asked for
   * (`/goal` without mode-goal, an uninstalled mode in the picker, a
   * `set_default` naming it). Category = registry kind (`mode`, `provider`,
   * …), name = the contribution's registered name.
   */
  readonly provides?: ReadonlyArray<{ readonly category: string; readonly name: string }>;
}

export interface PluginPickerOption {
  readonly value: string;
  readonly label: string;
  readonly hint: string;
}

export type PluginAction = 'install' | 'open' | 'enable' | 'disable' | 'remove' | 'back';

export interface PluginActionOption {
  readonly value: PluginAction;
  readonly label: string;
  readonly hint: string;
}

export type PluginCatalogStatus = 'not installed' | 'installed' | 'disabled';

/** Built-in, curated list of installable plugins. Users can also install any
 *  npm package / GitHub spec / local path directly by name. */
export const INSTALLABLE_PLUGIN_CATALOG: ReadonlyArray<PluginCatalogEntry> = [
  // API-key providers — NOT bundled into the binary (the kernel is slim); they
  // install on demand from npm. `moxxy init` is the guided path (it also collects
  // the key into the vault); installing one here drops in the package + enables
  // it, then add its key via `moxxy init` / `/vault`. installSpec is the bare
  // package (latest published), matching init/provision.
  {
    id: 'provider-anthropic',
    label: 'Anthropic (Claude)',
    description: 'Anthropic Claude models. Needs an API key (moxxy init or /vault).',
    packageName: '@moxxy/plugin-provider-anthropic',
    installSpec: '@moxxy/plugin-provider-anthropic',
    provides: [{ category: 'provider', name: 'anthropic' }],
  },
  {
    id: 'provider-openai',
    label: 'OpenAI (GPT)',
    description: 'OpenAI GPT models. Needs an API key (moxxy init or /vault).',
    packageName: '@moxxy/plugin-provider-openai',
    installSpec: '@moxxy/plugin-provider-openai',
    provides: [{ category: 'provider', name: 'openai' }],
  },
  {
    id: 'provider-google',
    label: 'Google (Gemini)',
    description: 'Google Gemini models. Needs an API key (moxxy init or /vault).',
    packageName: '@moxxy/plugin-provider-google',
    installSpec: '@moxxy/plugin-provider-google',
    provides: [{ category: 'provider', name: 'google' }],
  },
  {
    id: 'provider-xai',
    label: 'xAI (Grok)',
    description: 'xAI Grok models. Needs an API key (moxxy init or /vault).',
    packageName: '@moxxy/plugin-provider-xai',
    installSpec: '@moxxy/plugin-provider-xai',
    provides: [{ category: 'provider', name: 'xai' }],
  },
  {
    id: 'provider-zai',
    label: 'z.ai (GLM)',
    description: 'z.ai GLM models (API + GLM Coding Plan). Needs an API key (moxxy init or /vault).',
    packageName: '@moxxy/plugin-provider-zai',
    installSpec: '@moxxy/plugin-provider-zai',
    provides: [
      { category: 'provider', name: 'zai' },
      { category: 'provider', name: 'zai-plan' },
    ],
  },
  {
    id: 'provider-local',
    label: 'Local (Ollama)',
    description: 'Local models via an Ollama/OpenAI-compatible server. No API key needed.',
    packageName: '@moxxy/plugin-provider-local',
    installSpec: '@moxxy/plugin-provider-local',
    provides: [{ category: 'provider', name: 'local' }],
  },
  // Modes + capability plugins — NOT bundled (the kernel is slim); they
  // install on demand. The `provides` mapping lets /goal, /mode and
  // set_default offer install-on-first-use at the point a missing capability
  // is asked for. (mode-collaborative is still bundled — it unbundles with
  // the runner flip in a later batch.)
  {
    id: 'mode-goal',
    label: 'Goal mode',
    description: 'Autonomous goal loop — tools auto-approved until the objective is delivered.',
    packageName: '@moxxy/mode-goal',
    installSpec: '@moxxy/mode-goal',
    provides: [{ category: 'mode', name: 'goal' }],
  },
  {
    id: 'mode-deep-research',
    label: 'Research mode',
    description: 'Fan-out research: parallel queries + synthesis (installs subagents with it).',
    packageName: '@moxxy/mode-deep-research',
    installSpec: '@moxxy/mode-deep-research',
    provides: [{ category: 'mode', name: 'research' }],
  },
  {
    id: 'mode-collaborative',
    label: 'Collaborative mode',
    description: 'Multi-agent collaboration on a dedicated coordinator runner (/collab).',
    packageName: '@moxxy/mode-collaborative',
    installSpec: '@moxxy/mode-collaborative',
    provides: [{ category: 'mode', name: 'collaborative' }],
  },
  {
    id: 'subagents',
    label: 'Subagents',
    description: 'dispatch_agent tool — parallel child agents with scoped tool sets.',
    packageName: '@moxxy/plugin-subagents',
    installSpec: '@moxxy/plugin-subagents',
  },
  {
    id: 'oauth',
    label: 'OAuth client',
    description: 'Generic OAuth 2.0 + PKCE tools (oauth_authorize / oauth_get_token) for skills.',
    packageName: '@moxxy/plugin-oauth',
    installSpec: '@moxxy/plugin-oauth',
  },
  {
    id: 'computer-control',
    label: 'Computer control (macOS)',
    description: 'Screenshot, click, type, open, clipboard, AppleScript tools. macOS only.',
    packageName: '@moxxy/plugin-computer-control',
    installSpec: '@moxxy/plugin-computer-control',
  },
  {
    id: 'channel-http',
    label: 'HTTP channel',
    description: 'Drive moxxy over a local HTTP API (moxxy http).',
    packageName: '@moxxy/plugin-channel-http',
    installSpec: '@moxxy/plugin-channel-http',
    provides: [{ category: 'channel', name: 'http' }],
  },
  {
    id: 'usage-stats',
    label: 'Usage stats',
    description: 'Cross-session token usage aggregation behind /usage.',
    packageName: '@moxxy/plugin-usage-stats',
    installSpec: '@moxxy/plugin-usage-stats',
  },
  {
    id: 'view',
    label: 'Agent UIs (present_view)',
    description: 'present_view tool — the agent renders interactive UIs on the web surface.',
    packageName: '@moxxy/plugin-view',
    installSpec: '@moxxy/plugin-view',
  },
  {
    id: 'self-update',
    label: 'Self-update',
    description: 'self_update_* tools — the agent edits its own plugins/skills, transactionally.',
    packageName: '@moxxy/plugin-self-update',
    installSpec: '@moxxy/plugin-self-update',
  },
  {
    id: 'browser',
    label: 'Browser tools',
    description: 'Playwright-driven browser_session tools (installs playwright on demand).',
    packageName: '@moxxy/plugin-browser',
    installSpec: '@moxxy/plugin-browser',
  },
  {
    id: 'terminal',
    label: 'Terminal',
    description: 'Shared PTY terminal surface + terminal tool (node-pty optional).',
    packageName: '@moxxy/plugin-terminal',
    installSpec: '@moxxy/plugin-terminal',
  },
  {
    id: 'channel-web',
    label: 'Web surface',
    description: 'Local web chat surface + the canvas present_view renders into (moxxy web).',
    packageName: '@moxxy/plugin-channel-web',
    installSpec: '@moxxy/plugin-channel-web',
    provides: [{ category: 'channel', name: 'web' }],
  },
  {
    id: 'voice-admin',
    label: 'Voice control',
    description: 'set_voice / list_voices — switch the active text-to-speech backend.',
    packageName: '@moxxy/plugin-voice-admin',
    installSpec: '@moxxy/plugin-voice-admin',
  },
  {
    id: 'memory',
    label: 'Long-term memory',
    description: 'memory_save/recall + consolidation + the tfidf embedder — persistent memory across sessions.',
    packageName: '@moxxy/plugin-memory',
    installSpec: '@moxxy/plugin-memory',
  },
  {
    id: 'reflector',
    label: 'Learning loop',
    description:
      'Watches finished turns and proposes memory/skill improvements as a one-time nudge (never a silent write) — the model may act via memory_save/synthesize_skill.',
    packageName: '@moxxy/reflector-default',
    installSpec: '@moxxy/reflector-default',
    provides: [{ category: 'reflector', name: 'default' }],
  },
  {
    id: 'telegram',
    label: 'Telegram channel',
    description: 'Chat with moxxy from Telegram (moxxy telegram; QR pairing).',
    packageName: '@moxxy/plugin-telegram',
    installSpec: '@moxxy/plugin-telegram',
    provides: [{ category: 'channel', name: 'telegram' }],
  },
  {
    id: 'slack',
    label: 'Slack channel',
    description: 'Slack bot on a dedicated isolated runner (moxxy slack).',
    packageName: '@moxxy/plugin-channel-slack',
    installSpec: '@moxxy/plugin-channel-slack',
    provides: [{ category: 'channel', name: 'slack' }],
  },
  {
    id: 'signal',
    label: 'Signal channel',
    description:
      'Signal messenger on a dedicated isolated runner via a signal-cli sidecar (moxxy signal; requires the signal-cli binary on PATH).',
    packageName: '@moxxy/plugin-channel-signal',
    installSpec: '@moxxy/plugin-channel-signal',
    provides: [{ category: 'channel', name: 'signal' }],
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp channel',
    description:
      'WhatsApp via Baileys — UNOFFICIAL API: violates WhatsApp ToS, the number can be banned; use a secondary number (moxxy whatsapp).',
    packageName: '@moxxy/plugin-channel-whatsapp',
    installSpec: '@moxxy/plugin-channel-whatsapp',
    provides: [{ category: 'channel', name: 'whatsapp' }],
  },
  {
    id: 'discord',
    label: 'Discord channel',
    description: 'Discord bot on a dedicated isolated runner (moxxy discord; DM code pairing).',
    packageName: '@moxxy/plugin-channel-discord',
    installSpec: '@moxxy/plugin-channel-discord',
    provides: [{ category: 'channel', name: 'discord' }],
  },
  {
    id: 'stt-whisper',
    label: 'Whisper voice input',
    description: 'Speech-to-text via the OpenAI Whisper API (Ctrl+R in the TUI).',
    packageName: '@moxxy/plugin-stt-whisper',
    installSpec: '@moxxy/plugin-stt-whisper',
  },
  {
    id: 'stt-whisper-codex',
    label: 'Whisper via ChatGPT sign-in',
    description: 'Speech-to-text through a ChatGPT OAuth account (needs the codex provider).',
    packageName: '@moxxy/plugin-stt-whisper-codex',
    installSpec: '@moxxy/plugin-stt-whisper-codex',
  },
  {
    id: 'tts-openai',
    label: 'OpenAI read-aloud',
    description: 'Text-to-speech via the OpenAI /v1/audio/speech API (reuses OPENAI_API_KEY).',
    packageName: '@moxxy/plugin-tts-openai',
    installSpec: '@moxxy/plugin-tts-openai',
    provides: [{ category: 'synthesizer', name: 'openai-tts' }],
  },
  {
    id: 'provider-admin',
    label: 'Provider admin tools',
    description: 'provider_add/list/remove/test — register OpenAI-compatible vendors at runtime.',
    packageName: '@moxxy/plugin-provider-admin',
    installSpec: '@moxxy/plugin-provider-admin',
  },
  {
    id: 'mcp',
    label: 'MCP servers',
    description: 'Model Context Protocol client: mcp_add_server tools + lazy attach.',
    packageName: '@moxxy/plugin-mcp',
    installSpec: '@moxxy/plugin-mcp',
  },
  {
    id: 'virtual-office',
    label: 'Virtual Office',
    description: 'Pixel-art UI for running Moxxy with an office view and session picker.',
    packageName: '@moxxy/virtual-office-plugin',
    installSpec: 'github:moxxy-ai/virtual-office-plugin#main',
    startCommand: 'moxxy plugins open virtual-office',
    defaultPort: 17901,
    kind: 'ui',
  },
];

export function resolveCatalogEntry(
  target: string,
  catalog: ReadonlyArray<PluginCatalogEntry> = INSTALLABLE_PLUGIN_CATALOG,
): PluginCatalogEntry | undefined {
  return catalog.find((entry) => entry.id === target || entry.packageName === target);
}

export function resolveCatalogPackageName(
  target: string,
  catalog: ReadonlyArray<PluginCatalogEntry> = INSTALLABLE_PLUGIN_CATALOG,
): string {
  return resolveCatalogEntry(target, catalog)?.packageName ?? target;
}

/**
 * The catalog entry (if any) whose package provides the named contribution —
 * e.g. ('mode','goal') → the @moxxy/mode-goal entry. Lets surfaces turn a
 * missing-capability moment into an install offer.
 */
export function findCatalogEntryForContribution(
  category: string,
  name: string,
  catalog: ReadonlyArray<PluginCatalogEntry> = INSTALLABLE_PLUGIN_CATALOG,
): PluginCatalogEntry | undefined {
  return catalog.find((entry) =>
    entry.provides?.some((p) => p.category === category && p.name === name),
  );
}

export function buildPluginCatalogOptions(input: {
  readonly catalog: ReadonlyArray<PluginCatalogEntry>;
  readonly installedPackageNames: ReadonlySet<string>;
  readonly disabledPackageNames: ReadonlySet<string>;
}): PluginPickerOption[] {
  return input.catalog.map((entry) => ({
    value: entry.id,
    label: entry.label,
    hint: formatPluginCatalogStatus(entry, input.installedPackageNames, input.disabledPackageNames),
  }));
}

export function buildPluginActionOptions(input: {
  readonly entry: PluginCatalogEntry;
  readonly installedPackageNames: ReadonlySet<string>;
  readonly disabledPackageNames: ReadonlySet<string>;
}): PluginActionOption[] {
  const installed = input.installedPackageNames.has(input.entry.packageName);
  const disabled = input.disabledPackageNames.has(input.entry.packageName);
  const options: PluginActionOption[] = [];
  if (!installed) {
    options.push({
      value: 'install',
      label: 'Install',
      hint: input.entry.installSpec,
    });
  } else if (disabled) {
    options.push({
      value: 'enable',
      label: 'Enable',
      hint: 'allow this plugin to run',
    });
    options.push({
      value: 'remove',
      label: 'Remove',
      hint: 'uninstall from ~/.moxxy/plugins',
    });
  } else {
    if (input.entry.kind === 'ui') {
      options.push({
        value: 'open',
        label: 'Open',
        hint: input.entry.startCommand ?? `moxxy plugins open ${input.entry.id}`,
      });
    }
    options.push({
      value: 'disable',
      label: 'Disable',
      hint: 'keep installed, but block startup',
    });
    options.push({
      value: 'remove',
      label: 'Remove',
      hint: 'uninstall from ~/.moxxy/plugins',
    });
  }
  options.push({
    value: 'back',
    label: 'Back',
    hint: 'return without changes',
  });
  return options;
}

export function formatPluginCatalogStatus(
  entry: PluginCatalogEntry,
  installedPackageNames: ReadonlySet<string>,
  disabledPackageNames: ReadonlySet<string>,
): string {
  if (!installedPackageNames.has(entry.packageName)) return `not installed · ${entry.installSpec}`;
  if (disabledPackageNames.has(entry.packageName)) return 'disabled';
  return entry.startCommand ? `installed · ${entry.startCommand}` : 'installed';
}

export function buildInstallSpec(input: {
  readonly target: string;
  readonly version?: string;
  readonly ref?: string;
  readonly catalog?: ReadonlyArray<PluginCatalogEntry>;
}): string {
  const entry = resolveCatalogEntry(input.target, input.catalog);
  const base = entry?.installSpec ?? input.target;
  const withRef = input.ref ? applyGitRef(base, input.ref) : base;
  if (entry || input.ref || isGitLikeSpec(withRef) || isPathLikeSpec(withRef)) return withRef;
  return input.version ? `${withRef}@${input.version}` : withRef;
}

export function applyGitRef(spec: string, ref: string): string {
  const trimmed = ref.replace(/^#/, '');
  if (trimmed.length === 0) return spec;
  return spec.replace(/#.*$/, '') + `#${trimmed}`;
}

function isGitLikeSpec(spec: string): boolean {
  return (
    spec.startsWith('github:') ||
    spec.startsWith('git+') ||
    spec.startsWith('https://') ||
    spec.startsWith('ssh://') ||
    spec.includes('.git#')
  );
}

function isPathLikeSpec(spec: string): boolean {
  return spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('~');
}
