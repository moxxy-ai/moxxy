// ---------- Settings -------------------------------------------------------

/** Reasoning/thinking effort the desktop can request for the active session.
 *  `off` clears the preference; the others map to `config.context.reasoning`
 *  on the runner (`settings.setReasoning`). Mirrors the runner protocol's
 *  `ReasoningEffortLevel`. */
export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high';

export interface ProviderEntry {
  name: string;
  /** True when the runner has activated this provider (credentials
   *  resolved). False = entry exists but key is missing or invalid. */
  ready: boolean;
  /** False when the user disabled this provider (Settings toggle). */
  enabled: boolean;
  /** True when this is the runner's active provider (disable is refused). */
  active: boolean;
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
}

export interface McpServerEntry {
  name: string;
  enabled: boolean;
  connected: boolean;
}

export interface VaultEntryName {
  name: string;
}

export interface SkillFile {
  name: string;
  /** True if the file is editable (lives under ~/.moxxy/skills/). */
  editable: boolean;
  /** First line of the skill's frontmatter `description`, when present. */
  description?: string;
}
