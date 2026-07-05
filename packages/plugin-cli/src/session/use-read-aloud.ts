import { useEffect, useRef } from 'react';
import type { ClientSession as Session } from '@moxxy/sdk';
import { createReadAloud, type ReadAloud } from './read-aloud.js';

export interface UseReadAloudOptions {
  readonly session: Session;
  readonly setSystemNotice: (notice: string | null) => void;
}

/**
 * React wrapper around the {@link createReadAloud} controller. The controller
 * holds the auto-speak flag + in-flight playback in plain fields (no React
 * state) so the seam that speaks on turn completion reads the LATEST values;
 * the UI surfaces playing/failure state through `setSystemNotice`. The session
 * + notice setter are stable for the view's lifetime (BootShell re-mounts on a
 * session switch), so the controller is built once.
 */
export function useReadAloud(opts: UseReadAloudOptions): ReadAloud {
  const { session, setSystemNotice } = opts;
  const ref = useRef<ReadAloud | null>(null);
  if (ref.current === null) {
    ref.current = createReadAloud({ session, setSystemNotice });
  }
  // Unmount safety: stop playback so the spawned player is signalled to quit
  // and its temp file is cleaned up (TUI teardown / session switch / process
  // exit mid-playback).
  useEffect(() => {
    return () => {
      ref.current?.dispose();
    };
  }, []);
  return ref.current;
}
