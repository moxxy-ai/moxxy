import type { IconName } from '@moxxy/desktop-ui';

/** Something inside a section a person may look for by its own name. */
export interface SectionFind {
  readonly label: string;
  readonly keywords?: ReadonlyArray<string>;
}

export interface SettingsSection {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  /** The caption its row sits under in the index column. */
  readonly group: string;
  /** The view that lists it. */
  readonly view: 'settings' | 'extensions';
  /** Other words for the section itself. */
  readonly keywords: ReadonlyArray<string>;
  readonly finds: ReadonlyArray<SectionFind>;
}

/**
 * Every settings section, once: the index column, the pane and the command
 * palette all read this list, so a section cannot be listed in one of them and
 * be missing from another. `finds` names what is inside a section, for the
 * palette; a control added to a section is named here.
 */
export const SETTINGS_SECTIONS = [
  {
    id: 'providers',
    label: 'Providers',
    icon: 'agent',
    group: 'Agent',
    view: 'settings',
    keywords: ['model', 'models', 'llm', 'api key', 'openai', 'anthropic', 'claude', 'chatgpt', 'codex'],
    finds: [
      { label: 'Add provider', keywords: ['connect a model', 'new provider', 'sign in'] },
      {
        label: 'Default model',
        keywords: ['starting model', 'new conversation', 'reasoning effort', 'thinking', 'fast mode', 'fast tier'],
      },
    ],
  },
  {
    id: 'voice',
    label: 'Voice',
    icon: 'mic',
    group: 'Voice',
    view: 'settings',
    keywords: ['speech', 'tts', 'voice mode', 'read aloud'],
    finds: [
      { label: 'Voice engine', keywords: ['voice mode', 'local'] },
      { label: 'GPT-Live', keywords: ['chatgpt voice', 'realtime'] },
      { label: 'Gemini Flash-Lite', keywords: ['gemini tts', 'google', 'cloud voice', 'gemini api key'] },
      { label: 'Local Piper', keywords: ['on-device voice', 'offline voice'] },
    ],
  },
  {
    id: 'jev',
    label: 'Jev',
    icon: 'monitor',
    group: 'Computer use',
    view: 'settings',
    keywords: ['computer use', 'typesafe', 'screen control'],
    finds: [{ label: 'Use Jev' }],
  },
  {
    id: 'vault',
    label: 'Vault',
    icon: 'lock',
    group: 'Trust',
    view: 'settings',
    keywords: ['secrets', 'keys', 'tokens', 'credentials', 'passwords'],
    finds: [],
  },
  {
    id: 'preferences',
    label: 'Preferences',
    icon: 'sliders',
    group: 'App',
    view: 'settings',
    keywords: ['general', 'app'],
    finds: [
      { label: 'Appearance', keywords: ['look'] },
      { label: 'Theme', keywords: ['dark', 'light', 'system', 'dark mode', 'light mode'] },
      { label: 'Notifications', keywords: ['alerts'] },
      { label: 'Sound', keywords: ['chime', 'ring', 'mute'] },
      { label: 'System notification', keywords: ['banner', 'desktop notification'] },
      { label: 'Update', keywords: ['version', 'about', 'upgrade', 'runner version', 'cli'] },
    ],
  },
  {
    id: 'mcp',
    label: 'MCP',
    icon: 'plug',
    group: 'Extend',
    view: 'extensions',
    keywords: ['mcp servers', 'model context protocol', 'connectors'],
    finds: [{ label: 'Add MCP server' }],
  },
  {
    id: 'skills',
    label: 'Skills',
    icon: 'spark',
    group: 'Extend',
    view: 'extensions',
    keywords: ['prompts', 'instructions', 'markdown'],
    finds: [],
  },
] as const satisfies ReadonlyArray<SettingsSection>;

export type SettingsTab = (typeof SETTINGS_SECTIONS)[number]['id'];
export type SettingsScope = 'all' | SettingsSection['view'];

const SECTIONS: ReadonlyArray<SettingsSection & { readonly id: SettingsTab }> = SETTINGS_SECTIONS;

/** The sections a view lists, in order. */
export function sectionsIn(scope: SettingsScope): ReadonlyArray<SettingsSection & { readonly id: SettingsTab }> {
  return scope === 'all' ? SECTIONS : SECTIONS.filter((section) => section.view === scope);
}
