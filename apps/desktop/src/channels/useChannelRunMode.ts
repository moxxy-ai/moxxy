import { useCallback, useState } from 'react';
import { toErrorMessage } from '@moxxy/client-core';
import type { ChannelRunMode } from '@moxxy/desktop-ipc-contract';

export interface RunModeOption {
  readonly mode: ChannelRunMode;
  readonly label: string;
  readonly hint: string;
}

const OPTIONS: ReadonlyArray<RunModeOption> = [
  { mode: 'manual', label: 'Manual', hint: 'Runs only while you start it here.' },
  {
    mode: 'app',
    label: 'With the app',
    hint: 'Starts by itself when the app opens and stops when you quit it.',
  },
  {
    mode: 'background',
    label: 'Always (background)',
    hint: 'A background service that stays online 24/7, even with the app closed. Switch back to turn it off completely.',
  },
];

export interface ChannelRunModeState {
  readonly options: ReadonlyArray<RunModeOption>;
  readonly current: ChannelRunMode;
  readonly busy: boolean;
  readonly error: string | null;
  /** Human status of the OS background service; null outside background mode. */
  readonly serviceLabel: string | null;
  readonly choose: (mode: ChannelRunMode) => Promise<void>;
}

export function useChannelRunMode(options: {
  readonly channelId: string;
  readonly runMode: ChannelRunMode | undefined;
  readonly background: { readonly installed: boolean; readonly running: boolean } | undefined;
  readonly setRunMode: (channelId: string, mode: ChannelRunMode) => Promise<void>;
}): ChannelRunModeState {
  const { channelId, runMode, background, setRunMode } = options;
  const current = runMode ?? 'manual';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = useCallback(
    async (mode: ChannelRunMode): Promise<void> => {
      if (mode === current) return;
      setBusy(true);
      try {
        await setRunMode(channelId, mode);
        setError(null);
      } catch (e) {
        setError(toErrorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [channelId, current, setRunMode],
  );

  let serviceLabel: string | null = null;
  if (current === 'background' && background) {
    serviceLabel = background.running
      ? 'Running in the background (starts at login)'
      : background.installed
        ? 'Background service installed but not running — check its log'
        : 'Background service missing — choose the mode again to reinstall it';
  }

  return { options: OPTIONS, current, busy, error, serviceLabel, choose };
}
