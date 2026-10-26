import type { AppNoticeTarget } from '@moxxy/desktop-ipc-contract';
import type { IconName } from '@moxxy/desktop-ui';
import type { AutomationKind } from '../../automations/kinds';
import { SETTINGS_SECTIONS, type SettingsSection, type SettingsTab } from '../../settings/sections';
import { DESTINATIONS, type DestinationId } from './destinations';

/** A section of a view that lists sections. */
export type SectionTarget =
  | { readonly destination: 'settings' | 'extensions'; readonly section: SettingsTab }
  | { readonly destination: 'automations'; readonly section: AutomationKind }
  | { readonly destination: 'channels'; readonly section: string };

/** Where a place is: a view, or one section of it. */
export type PlaceTarget = { readonly destination: DestinationId } | SectionTarget | { readonly destination: 'chat'; readonly pane: 'media' | 'agents' };

const SECTIONS: ReadonlyArray<SettingsSection & { readonly id: SettingsTab }> = SETTINGS_SECTIONS;

/** The section a host notice points at, in the view it belongs to; `null` for
 *  a section this window does not have. */
export function noticePlace(target: AppNoticeTarget): SectionTarget | null {
  const section = SECTIONS.find((candidate) => candidate.id === target.section);
  return section ? { destination: section.view, section: section.id } : null;
}

/** Something a person can ask the palette for by name. */
export interface Place {
  readonly id: string;
  readonly label: string;
  /** Where it is, when its name alone does not say. */
  readonly trail?: string;
  readonly icon: IconName;
  /** Other words a person may type for it. */
  readonly keywords: ReadonlyArray<string>;
  readonly target: PlaceTarget;
  /** Listed before anything is typed. */
  readonly top?: boolean;
}

/** A record, so a destination added without its words fails to compile. */
const DESTINATION_FINDS: Readonly<Record<DestinationId, { readonly label?: string; readonly keywords: ReadonlyArray<string> }>> = {
  chat: { keywords: ['chat', 'chats', 'conversation', 'conversations', 'sessions', 'messages', 'workspaces'] },
  extensions: { keywords: ['plugins', 'add-ons', 'integrations'] },
  collaborate: { keywords: ['agents', 'team', 'multi-agent'] },
  automations: { keywords: ['automation', 'automate'] },
  apps: { keywords: ['gallery'] },
  channels: { keywords: ['bots', 'messengers'] },
  mobile: { keywords: ['phone', 'pairing', 'qr code', 'ios', 'android', 'gateway'] },
  // A call on the run, not a view: its row says what picking it does.
  voice: { label: 'Start a voice call', keywords: ['talk', 'speak'] },
  settings: { keywords: ['options', 'configuration', 'config'] },
};

const AUTOMATION_KINDS: Readonly<Record<AutomationKind, { readonly label: string; readonly keywords: ReadonlyArray<string> }>> = {
  workflows: { label: 'Workflows', keywords: ['pipeline', 'flow', 'dag'] },
  schedules: { label: 'Schedules', keywords: ['cron', 'timer', 'recurring', 'scheduled'] },
  webhooks: { label: 'Webhooks', keywords: ['trigger', 'http', 'events'] },
};

function labelOf(id: DestinationId): string {
  return DESTINATIONS.find((destination) => destination.id === id)?.label ?? id;
}

const destinationPlaces: ReadonlyArray<Place> = DESTINATIONS.map((destination) => {
  const find = DESTINATION_FINDS[destination.id];
  return {
    id: destination.id,
    label: find.label ?? destination.label,
    icon: destination.icon,
    keywords: find.keywords,
    target: { destination: destination.id },
    top: true,
  };
});

function sectionPlaces(section: SettingsSection & { readonly id: SettingsTab }): ReadonlyArray<Place> {
  const target: SectionTarget = { destination: section.view, section: section.id };
  const view = labelOf(section.view);
  return [
    { id: `${section.view}/${section.id}`, label: section.label, trail: view, icon: section.icon, keywords: section.keywords, target },
    ...section.finds.map((find) => ({
      id: `${section.view}/${section.id}/${find.label}`,
      label: find.label,
      trail: `${view} › ${section.label}`,
      icon: section.icon,
      keywords: find.keywords ?? [],
      target,
    })),
  ];
}

const automationPlaces: ReadonlyArray<Place> = (Object.keys(AUTOMATION_KINDS) as AutomationKind[]).map((kind) => ({
  id: `automations/${kind}`,
  label: AUTOMATION_KINDS[kind].label,
  trail: labelOf('automations'),
  icon: 'workflow',
  keywords: AUTOMATION_KINDS[kind].keywords,
  target: { destination: 'automations', section: kind },
}));

/**
 * Every place that is known before the app has loaded anything: the views,
 * the sections of Settings and Extensions with what is inside them, and the
 * kinds of automation. Channels and apps are added by {@link channelPlace} and
 * {@link appPlace} once they are known.
 */
export const STATIC_PLACES: ReadonlyArray<Place> = [
  ...destinationPlaces,
  ...SETTINGS_SECTIONS.flatMap(sectionPlaces),
  ...automationPlaces,
  { id: 'chat/media', label: 'Media', trail: 'Chat', icon: 'image', keywords: ['photos', 'images', 'shared files', 'shared links', 'library', 'attachments'], target: { destination: 'chat', pane: 'media' } },
  { id: 'chat/agents', label: 'Agents', trail: 'Chat', icon: 'agent', keywords: ['background work', 'helpers', 'subagents', 'background commands', 'running tasks'], target: { destination: 'chat', pane: 'agents' } },
];

export function channelPlace(channel: { readonly id: string; readonly name: string }): Place {
  return {
    id: `channels/${channel.id}`,
    label: channel.name,
    trail: labelOf('channels'),
    icon: 'broadcast',
    keywords: [channel.id, 'bot'],
    target: { destination: 'channels', section: channel.id },
  };
}

/** An app opens from the gallery, so that is where its place leads. */
export function appPlace(app: {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon?: IconName;
}): Place {
  return {
    id: `apps/${app.id}`,
    label: app.name,
    trail: labelOf('apps'),
    icon: app.icon ?? 'grid',
    keywords: [app.id, app.description],
    target: { destination: 'apps' },
  };
}
