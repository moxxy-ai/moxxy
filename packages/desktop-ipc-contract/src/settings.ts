// ---------- Settings -------------------------------------------------------

import type { AgentCliReport } from '@moxxy/sdk';

/** Reasoning/thinking effort the desktop can request for the active session.
 *  `off` clears the preference; the others map to `config.context.reasoning`
 *  on the runner (`settings.setReasoning`). Mirrors the runner protocol's
 *  `ReasoningEffortLevel`. */
export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high' | 'xhigh';

/** A change to what a new conversation starts with — in the app, the terminal and the channels. Only what is named is saved. */
export interface ModelDefaultsChange {
  /** A provider and the model it runs, set together. */
  model?: { provider: string; model: string };
  effort?: ReasoningEffort;
  fast?: boolean;
}

/** The defaults as the config holds them: nothing may be set yet, and reasoning may be on at the provider's own effort. */
export interface StoredModelDefaults {
  provider: string | null;
  model: string | null;
  effort: ReasoningEffort | 'default';
  fast: boolean;
}

export interface ProviderEntry {
  name: string;
  /** True when the runner has activated this provider (credentials
   *  resolved). False = entry exists but key is missing or invalid. */
  ready: boolean;
  /** False when the user disabled this provider (Settings toggle). */
  enabled: boolean;
  /** True when this is the runner's active provider (disable is refused). */
  active: boolean;
  /** Runtime reachability for providers backed by a user-operated server.
   *  `ready` may only mean configuration/credentials resolved; this field
   *  distinguishes that from a server that actually answered a probe. */
  connected?: boolean;
  /** 'oauth' providers authenticate via `moxxy login`, not a vault key. */
  authKind: 'oauth' | 'api-key';
  /** 'admin' = runtime-registered via providers.json (configurable);
   *  'builtin' = ships with moxxy (key/enable management only). */
  kind: 'builtin' | 'admin';
  /** Vault entry name holding this provider's API key (`<NAME>_API_KEY` or
   *  the stored envVar override). The Configure sheet writes it via
   *  `settings.vaultSet` then calls `settings.providerRefreshReady`. */
  keyName: string;
  /** Stored entry detail — admin providers only. */
  baseURL?: string;
  defaultModel?: string;
  modelIds?: ReadonlyArray<string>;
  /** True when at least one of this provider's models advertises
   *  `supportsReasoning` — gates the Configure sheet's reasoning-effort
   *  selector. Derived from the runner's model catalog (the desktop never sees
   *  raw `ModelDescriptor`s). Absent ⇒ unknown/false. */
  supportsReasoning?: boolean;
  /** For an agent connection, the agent's name as the person knows it ("Codex"). */
  agentName?: string;
  /** For an agent connection, the last check of its CLI: installed, current, signed in. */
  agentCli?: AgentCliReport;
}

/** What installing or updating an agent's CLI does. */
export type AgentCliAction = 'install' | 'update';

/** How an install or update ended: `message` is the last line it printed, or why it failed. */
export interface AgentCliRunResult {
  ok: boolean;
  message: string;
}

/** A line an installer or updater printed, and how far it got when it said so. */
export interface AgentCliProgress {
  provider: string;
  action: AgentCliAction;
  line?: string;
  /** 0–1, from a percentage it printed. */
  fraction?: number;
}

export interface McpServerEntry {
  name: string;
  enabled: boolean;
  connected: boolean;
}

export interface VaultEntryName {
  name: string;
}

/** A voice returned by Google's authenticated Gemini Voices endpoint. */
export interface GeminiVoiceInfo {
  readonly id: string;
  readonly displayName: string;
  readonly languageCode?: string;
  readonly description?: string;
}

export interface SkillFile {
  name: string;
  /** True if the file is editable (lives under ~/.moxxy/skills/). */
  editable: boolean;
  /** First line of the skill's frontmatter `description`, when present. */
  description?: string;
}
