import { useActiveWorkspaceId, useDesks } from '@moxxy/client-core';
import { toggleSidebarCollapsed } from '@/lib/useSidebarCollapsed';
import {
  abortTurnPulse,
  commandPalettePulse,
  focusComposerPulse,
  transcriptSearchPulse,
} from '@/lib/chatPulses';
import type { View } from '../shell/views';
import type { WorkbenchTab } from '../shell/Workbench';
import { useHotkeyList } from './useHotkeys';
import type { HotkeyBinding } from './registry';

export interface AppHotkeysOptions {
  readonly setView: (view: View) => void;
  readonly benchTab: WorkbenchTab | null;
  readonly setBenchTab: (tab: WorkbenchTab | null) => void;
  readonly onShowShortcuts: () => void;
}

/** Primary rail destinations in rail order. Optional capabilities stay in More. */
const NUMBERED_VIEWS: ReadonlyArray<{ view: View; label: string }> = [
  { view: 'chat', label: 'Runs' },
  { view: 'extensions', label: 'Extensions' },
  { view: 'settings', label: 'Settings' },
];

/**
 * The app's keymap, in one place.
 *
 * Actions that live inside the chat surface (palette, search, abort, composer
 * focus) are reached through pulses rather than by lifting their state up. See
 * `lib/pulse`.
 */
export function useAppHotkeys(opts: AppHotkeysOptions): void {
  const { setView, benchTab, setBenchTab, onShowShortcuts } = opts;
  const desks = useDesks();
  const activeSessionId = useActiveWorkspaceId();

  // Every session across every workspace, in the order the sidebar tree shows
  // them, so "next session" moves the way the list looks.
  const ordered = desks.desks.flatMap((desk) => desk.sessions.map((s) => s.id));
  const currentIndex = activeSessionId ? ordered.indexOf(activeSessionId) : -1;

  const step = (delta: number): void => {
    if (ordered.length < 2 || currentIndex < 0) return;
    const next = ordered[(currentIndex + delta + ordered.length) % ordered.length];
    if (next) void desks.setActiveSession(next);
  };

  const bindings: HotkeyBinding[] = [
    {
      id: 'chat.palette',
      chord: 'mod+k',
      label: 'Open the command palette',
      group: 'Chat',
      run: () => {
        setView('chat');
        commandPalettePulse.request();
      },
    },
    {
      id: 'chat.focusComposer',
      chord: 'mod+l',
      label: 'Focus the composer',
      group: 'Chat',
      run: () => {
        setView('chat');
        focusComposerPulse.request();
      },
    },
    {
      id: 'chat.search',
      chord: 'mod+f',
      label: 'Search this conversation',
      group: 'Chat',
      run: () => {
        setView('chat');
        transcriptSearchPulse.request();
      },
    },
    {
      id: 'chat.abort',
      chord: 'mod+.',
      label: 'Interrupt the running turn',
      group: 'Chat',
      run: () => abortTurnPulse.request(),
    },
    {
      id: 'session.new',
      chord: 'mod+n',
      label: 'New session in this workspace',
      group: 'Sessions',
      disabled: desks.activeId === null,
      run: () => {
        const deskId = desks.activeId;
        if (!deskId) return;
        void (async () => {
          const session = await desks.createSession(deskId);
          if (session) await desks.setActiveSession(session.id);
        })();
      },
    },
    {
      id: 'session.next',
      chord: 'mod+alt+arrowdown',
      label: 'Next session',
      group: 'Sessions',
      disabled: ordered.length < 2,
      run: () => step(1),
    },
    {
      id: 'session.prev',
      chord: 'mod+alt+arrowup',
      label: 'Previous session',
      group: 'Sessions',
      disabled: ordered.length < 2,
      run: () => step(-1),
    },
    {
      id: 'view.sidebar',
      chord: 'mod+b',
      label: 'Show or hide the workspace sidebar',
      group: 'Navigation',
      // ⌘B is bold inside a text field; leave typing alone (this preserves the
      // behaviour of the hand-rolled handler this keymap replaced).
      allowInEditable: false,
      run: () => toggleSidebarCollapsed(),
    },
    {
      id: 'view.workbench',
      chord: 'mod+j',
      label: 'Show or hide the workbench pane',
      group: 'Navigation',
      run: () => setBenchTab(benchTab ? null : 'files'),
    },
    {
      id: 'view.settings',
      chord: 'mod+,',
      label: 'Open settings',
      group: 'Navigation',
      run: () => setView('settings'),
    },
    ...NUMBERED_VIEWS.map(({ view, label }, index) => ({
      id: `view.${view}`,
      chord: `mod+${index + 1}`,
      label: `Go to ${label}`,
      group: 'Navigation',
      run: () => setView(view),
    })),
    {
      id: 'help.shortcuts',
      chord: 'mod+/',
      label: 'Show keyboard shortcuts',
      group: 'Help',
      run: onShowShortcuts,
    },
  ];

  useHotkeyList(bindings);
}
