import { useEffect, useMemo, useState } from 'react';

export const STARTUP_WAIT_MS = 30_000;

export function useStartupWait(stage: string, delayMs = STARTUP_WAIT_MS): boolean {
  // A new occurrence of the same stage must not inherit an earlier timeout.
  const occurrence=useMemo(() => ({stage}),[stage]);
  const [expired,setExpired]=useState<typeof occurrence | null>(null);
  useEffect(() => {
    const timer=setTimeout(() => setExpired(occurrence),delayMs);
    return () => clearTimeout(timer);
  },[occurrence,delayMs]);
  return expired===occurrence;
}
