import type { IconName } from '@moxxy/desktop-ui';
import type { View } from '../views';

/** A place the shell can take you: a view, or voice, which opens on the run. */
export type DestinationId = View | 'voice';

export interface Destination {
  readonly id: DestinationId;
  readonly label: string;
  readonly icon: IconName;
  /** The shortcut that goes there, as a hotkey chord. */
  readonly chord?: string;
}

/**
 * Every place in the app, once. The account menu, the command palette and the
 * numbered shortcuts all read this list, so a place cannot exist in one of them
 * and be missing from another.
 */
export const DESTINATIONS: ReadonlyArray<Destination> = [
  // The id stays `chat`: the surface behind it is `src/chat` and the chat store.
  // "Runs" is the product's name for what it shows.
  { id: 'chat', label: 'Runs', icon: 'chat', chord: 'mod+1' },
  { id: 'extensions', label: 'Extensions', icon: 'plug', chord: 'mod+2' },
  { id: 'collaborate', label: 'Collaborate', icon: 'agent' },
  { id: 'automations', label: 'Automations', icon: 'workflow' },
  { id: 'apps', label: 'Apps', icon: 'grid' },
  { id: 'channels', label: 'Channels', icon: 'broadcast' },
  { id: 'mobile', label: 'Mobile', icon: 'smartphone' },
  { id: 'voice', label: 'Voice', icon: 'speaker' },
  { id: 'settings', label: 'Settings', icon: 'settings', chord: 'mod+,' },
];

/** Views that read the runner session and cannot render while it loads. */
const RUNNER_LOCKED: ReadonlySet<DestinationId> = new Set(['collaborate', 'apps', 'automations']);

export const RUNNER_LOCKED_REASON = 'Moxxy is still loading this session';

export function isRunnerLocked(id: DestinationId): boolean {
  return RUNNER_LOCKED.has(id);
}

/** The view a destination shows. Voice is a call on the run, so it shows the run. */
export function viewOf(id: DestinationId): View {
  return id === 'voice' ? 'chat' : id;
}
