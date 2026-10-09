import { useCallback, useMemo } from 'react';
import { useAutomationsKind } from '../../automations/AutomationsPanel';
import type { AutomationKind } from '../../automations/kinds';
import { useChannelSelection } from '../../channels/ChannelsSurface';
import { useSettingsTab, type SettingsTab } from '../../settings/SettingsPanel';
import type { SectionTarget } from './places';

export interface Sections {
  readonly automationsKind: AutomationKind;
  readonly setAutomationsKind: (kind: AutomationKind) => void;
  readonly channelId: string | null;
  readonly setChannelId: (id: string) => void;
  readonly extensionsTab: SettingsTab;
  readonly setExtensionsTab: (tab: SettingsTab) => void;
  readonly settingsTab: SettingsTab;
  readonly setSettingsTab: (tab: SettingsTab) => void;
  /** Shows the section a link names, in the view it belongs to. */
  readonly show: (target: SectionTarget) => void;
}

/**
 * The section each view shows. Every view remembers its own, so leaving one
 * and coming back does not reset it to its first entry.
 */
export function useSections(): Sections {
  const [automationsKind, setAutomationsKind] = useAutomationsKind();
  const [channelId, setChannelId] = useChannelSelection();
  const [extensionsTab, setExtensionsTab] = useSettingsTab('extensions');
  const [settingsTab, setSettingsTab] = useSettingsTab('settings');

  const show = useCallback(
    (target: SectionTarget): void => {
      if (target.destination === 'settings') setSettingsTab(target.section);
      else if (target.destination === 'extensions') setExtensionsTab(target.section);
      else if (target.destination === 'automations') setAutomationsKind(target.section);
      else setChannelId(target.section);
    },
    [setSettingsTab, setExtensionsTab, setAutomationsKind, setChannelId],
  );

  return useMemo(
    () => ({
      automationsKind,
      setAutomationsKind,
      channelId,
      setChannelId,
      extensionsTab,
      setExtensionsTab,
      settingsTab,
      setSettingsTab,
      show,
    }),
    [automationsKind, setAutomationsKind, channelId, setChannelId, extensionsTab, setExtensionsTab, settingsTab, setSettingsTab, show],
  );
}
